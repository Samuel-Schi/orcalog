import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed } from './_shared.js';

type Registro = { linha: string; tipo: string; item: string; ativo: boolean };

const buscarTudo = async (base: string, secret: string, tabela: string, params: Record<string, string>) => {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${base}/rest/v1/${tabela}`);
    for (const [chave, valor] of Object.entries(params)) url.searchParams.set(chave, valor);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json', apikey: secret, Authorization: `Bearer ${secret}`, 'Accept-Profile': 'public' }
    });
    if (!response.ok) throw new Error(`Falha ao consultar ${tabela}.`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error(`Resposta invalida de ${tabela}.`);
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < pageSize) break;
  }
  return rows;
};

/**
 * PECAS vem do catalogo canonico (item_padrao + item_padrao_linha): o mesmo padrao da importacao e da
 * base historica. DEFEITO / SERVICO / ACESSORIO / CONDICAO continuam no catalogo_qualidade.
 * Se o catalogo canonico falhar ou estiver vazio, cai nas pecas antigas do catalogo_qualidade.
 */
export const pecasCanonicas = (padroes: Record<string, unknown>[], linhas: Record<string, unknown>[]): Registro[] => {
  const nomes = new Map<string, string>();
  for (const p of padroes) {
    if (p.ativo === false || String(p.tipo ?? 'PECA').toUpperCase() !== 'PECA') continue;
    nomes.set(String(p.codigo), String(p.nome_canonico ?? '').trim());
  }
  const registros: Registro[] = [];
  for (const l of linhas) {
    const nome = nomes.get(String(l.codigo));
    const linha = String(l.linha ?? '').trim();
    if (nome && linha) registros.push({ linha, tipo: 'PECA', item: nome, ativo: true });
  }
  return registros.sort((a, b) => a.linha.localeCompare(b.linha) || a.item.localeCompare(b.item, 'pt-BR'));
};

export const consultarCatalogo = async (env: Record<string, string | undefined>) => {
  const base = (env.SUPABASE_ORCAMENTOS_URL || env.SUPABASE_URL || '').trim()
    .replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
  const secret = (env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !secret) return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });

  let qualidade: Record<string, unknown>[];
  try {
    qualidade = await buscarTudo(base, secret, 'catalogo_qualidade', { select: 'id,linha,tipo,item,ativo', ativo: 'eq.true', order: 'id.asc' });
  } catch {
    return jsonResponse(502, { error: 'Falha ao consultar o catalogo no Supabase.' });
  }

  let pecas: Registro[] = [];
  try {
    const [padroes, linhas] = await Promise.all([
      buscarTudo(base, secret, 'item_padrao', { select: 'codigo,nome_canonico,tipo,ativo' }),
      buscarTudo(base, secret, 'item_padrao_linha', { select: 'codigo,linha' })
    ]);
    pecas = pecasCanonicas(padroes, linhas);
  } catch {
    pecas = [];
  }
  if (!pecas.length) return jsonResponse(200, qualidade);

  const semPecasAntigas = qualidade.filter((r) => String(r.tipo ?? '').toUpperCase().replace(/S$/, '') !== 'PECA');
  return jsonResponse(200, [...pecas, ...semPecasAntigas]);
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);
  try {
    return await consultarCatalogo(process.env);
  } catch (error) {
    return handleFunctionError(error);
  }
};
