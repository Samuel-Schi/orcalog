import type { Handler, HandlerContext, HandlerEvent, HandlerResponse } from '@netlify/functions';

/*
 * Roda na Vercel as mesmas Functions do Netlify (netlify/functions), sem reescrever nenhuma.
 * Uma unica Function da Vercel recebe todas as rotas: o vercel.json reescreve /check-user, /get_envios etc.
 * para /api/netlify?__fn=<nome-da-function>, e aqui o pedido vira o "event" que o Netlify entregaria.
 * Os imports relativos das Functions terminam em ".js" porque a Vercel nao empacota o codigo (ESM do Node).
 */

type Modulo = { handler: Handler };

const FUNCOES: Record<string, () => Promise<Modulo>> = {
  'bet-user-inf': () => import('../netlify/functions/bet-user-inf.js'),
  'check-user': () => import('../netlify/functions/check-user.js'),
  'consulta-cnpj': () => import('../netlify/functions/consulta-cnpj.js'),
  'gerar-serial-peca': () => import('../netlify/functions/gerar-serial-peca.js'),
  'get-catalogo-qualidade': () => import('../netlify/functions/get-catalogo-qualidade.js'),
  'get-envios-negociacoes-supabase': () => import('../netlify/functions/get-envios-negociacoes-supabase.js'),
  'get-envios-status-supabase': () => import('../netlify/functions/get-envios-status-supabase.js'),
  'get-envios': () => import('../netlify/functions/get-envios.js'),
  'get-item-padrao': () => import('../netlify/functions/get-item-padrao.js'),
  'get-lancamento-drafts-supabase': () => import('../netlify/functions/get-lancamento-drafts-supabase.js'),
  'get-orcamento-draft-supabase': () => import('../netlify/functions/get-orcamento-draft-supabase.js'),
  'get-orcamentos-analise': () => import('../netlify/functions/get-orcamentos-analise.js'),
  'get-pagamentos-supabase': () => import('../netlify/functions/get-pagamentos-supabase.js'),
  'get-produto-cadastro': () => import('../netlify/functions/get-produto-cadastro.js'),
  'get-produto-codigo-barras': () => import('../netlify/functions/get-produto-codigo-barras.js'),
  'get-user-inf': () => import('../netlify/functions/get-user-inf.js'),
  'item-padrao-decisao': () => import('../netlify/functions/item-padrao-decisao.js'),
  'lancar-valores-orcamento': () => import('../netlify/functions/lancar-valores-orcamento.js'),
  'lote-posto': () => import('../netlify/functions/lote-posto.js'),
  'notificacoes-pa': () => import('../netlify/functions/notificacoes-pa.js'),
  'post-envio-negociacao-resposta': () => import('../netlify/functions/post-envio-negociacao-resposta.js'),
  'post-orcamento-final': () => import('../netlify/functions/post-orcamento-final.js'),
  'register-posto': () => import('../netlify/functions/register-posto.js'),
  'salvar-orcamento': () => import('../netlify/functions/salvar-orcamento.js'),
  'save-pagamento-supabase': () => import('../netlify/functions/save-pagamento-supabase.js'),
  'sync-orcamento-supabase': () => import('../netlify/functions/sync-orcamento-supabase.js'),
  'upload-foto-drive': () => import('../netlify/functions/upload-foto-drive.js'),
  'upsert-lancamento-draft-supabase': () => import('../netlify/functions/upsert-lancamento-draft-supabase.js'),
  'upsert-orcamento-draft-supabase': () => import('../netlify/functions/upsert-orcamento-draft-supabase.js')
};

const PARAMETRO = '__fn';
const SEM_CORPO = new Set([101, 204, 205, 304]);
const TIPO_TEXTO = /^(text\/|application\/(json|x-www-form-urlencoded|xml|javascript)|[^;]*\+(json|xml))/i;

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

/** Nome da Function: vem do ?__fn= da reescrita; sem ele, do fim do caminho (/api/netlify/check-user ou /.netlify/functions/check-user). */
export const nomeDaFuncao = (url: URL) => {
  const doParametro = url.searchParams.get(PARAMETRO);
  if (doParametro) return doParametro;
  const ultimo = url.pathname.split('/').filter(Boolean).pop() || '';
  return ultimo === 'netlify' ? '' : ultimo;
};

/** Monta o mesmo event (formato v1) que o Netlify entrega para handler(event). */
export const montarEvento = async (request: Request, url: URL): Promise<HandlerEvent> => {
  const parametros = new URLSearchParams(url.search);
  parametros.delete(PARAMETRO);
  const query: Record<string, string> = {};
  const queryMulti: Record<string, string[]> = {};
  for (const [chave, valor] of parametros) {
    query[chave] = valor;
    (queryMulti[chave] ??= []).push(valor);
  }

  const headers: Record<string, string> = {};
  const headersMulti: Record<string, string[]> = {};
  request.headers.forEach((valor, chave) => { headers[chave] = valor; headersMulti[chave] = [valor]; });

  let body: string | null = null;
  let isBase64Encoded = false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const tipo = request.headers.get('content-type') || '';
    if (!tipo || TIPO_TEXTO.test(tipo)) {
      body = await request.text();
    } else {
      body = Buffer.from(await request.arrayBuffer()).toString('base64');
      isBase64Encoded = true;
    }
    if (body === '') body = null;
  }

  const rawQuery = parametros.toString();
  return {
    rawUrl: `${url.origin}${url.pathname}${rawQuery ? `?${rawQuery}` : ''}`,
    rawQuery,
    path: url.pathname,
    httpMethod: request.method,
    headers,
    multiValueHeaders: headersMulti,
    queryStringParameters: query,
    multiValueQueryStringParameters: queryMulti,
    body,
    isBase64Encoded
  };
};

/** Converte a resposta do handler do Netlify em Response. */
export const montarResposta = (resultado: HandlerResponse | void) => {
  if (!resultado) return json(500, { error: 'A função não devolveu resposta.' });
  const headers = new Headers();
  for (const [chave, valor] of Object.entries(resultado.headers || {})) headers.set(chave, String(valor));
  for (const [chave, valores] of Object.entries(resultado.multiValueHeaders || {})) {
    for (const valor of valores) headers.append(chave, String(valor));
  }
  const status = resultado.statusCode || 200;
  const corpo = SEM_CORPO.has(status) || resultado.body == null
    ? null
    : resultado.isBase64Encoded ? Buffer.from(resultado.body, 'base64') : resultado.body;
  return new Response(corpo, { status, headers });
};

export const atender = async (request: Request) => {
  const url = new URL(request.url);
  const nome = nomeDaFuncao(url);
  const carregar = Object.prototype.hasOwnProperty.call(FUNCOES, nome) ? FUNCOES[nome] : undefined;
  if (!carregar) return json(404, { error: 'Rota não encontrada.' });
  try {
    const { handler } = await carregar();
    const evento = await montarEvento(request, url);
    const resultado = await handler(evento, {} as HandlerContext, () => undefined);
    return montarResposta(resultado as HandlerResponse | void);
  } catch (error) {
    console.error(`[${nome}]`, error);
    return json(500, { error: 'Erro interno ao processar a requisição.' });
  }
};

export default { fetch: atender };
