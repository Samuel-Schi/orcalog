import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from './oracle';
import { compactLookupValue, ErroImportacao, formatSerialValue } from './importacaoProdutos';
import {
  AVISO_SEM_SERIAL,
  inconsistenciasDoLote,
  novaChaveItem,
  montarItemCadastro,
  montarValoresOrcamento,
  seriaisDuplicados,
  type ItemOrcamentoPlanilha
} from './importacaoOrcamento';
import { normalizarNome, padronizarPeca, type CatalogoPadrao } from './pecaPadrao';
import { enviarEvidenciasDrive, nomePastaProtocolo, prefixoArquivoProduto } from './evidenciasDrive';

/*
 * Envio do orcamento no modelo novo (uma linha por produto, sem UUID).
 * Usado pela importacao por planilha e pelo lancamento manual.
 */

// Itens por chamada de sync: cada item e uma RPC no servidor, e a Function tem limite de tempo.
const ITENS_POR_ENVIO = 5;

export const UNIDADES = [49, 93, 299, 389, 549, 893, 985, 1116, 2099, 2599, 2999, 5299, 5599];

export const gerarProtocolo = () => {
  const now = new Date();
  return `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
};

export const formatCnpj = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return value;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

export const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const mensagemErro = (error: unknown) => {
  const data = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const detalhe = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
  return detalhe || (error instanceof Error ? error.message : '') || 'Falha inesperada.';
};

// get_produto_cadastro casa o valor com o Gemco (item) OU com o EAN (codigo_barra).
export const consultarCadastroProduto = async ({ item }: { item: string }) => {
  const res = await oracleApi.get(ORACLE_ENDPOINTS.getProdutoCadastro, {
    params: { item, codigo_barra: item, _ts: Date.now() },
    responseType: 'arraybuffer',
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    validateStatus: (status) => status >= 200 && status < 400
  });
  return parseMaybeJson(res.data);
};

const avisoTrocada = (original: string, canonico: string) =>
  `Peça "${original}" padronizada automaticamente como "${canonico}".`;
const avisoSemPadrao = (original: string) =>
  `Peça "${original}" não está no catálogo: vai com o nome original e o pedido de padrão novo é registrado no envio.`;

// Padroniza o nome de cada peca pelo catalogo canonico, escopado pela linha do produto (vinda do gemco).
// Nada aqui trava o envio (decisao do usuario em 13/11):
//  - nome exato ou apelido: troca pelo nome oficial, sem aviso;
//  - nome PARECIDO com um padrao: troca pelo padrao e avisa (o posto pode desfazer no painel);
//  - nome DESCONHECIDO: vai com o nome original e o pedido de padrao novo e registrado no envio.
export const aplicarPadraoPecas = (itens: ItemOrcamentoPlanilha[], catalogo: CatalogoPadrao) => {
  for (const item of itens) {
    const linhaProduto = item.produto?.linha;
    item.pendencias = item.pendencias.filter((p) => p.campo !== 'padrao');
    item.pecasSemPadrao = [];
    item.pecasPadronizadas = [];
    for (const peca of item.pecas) {
      const r = padronizarPeca(peca.nome, catalogo, linhaProduto);
      const linhaErrada = (canonico: string) => item.pendencias.push({
        campo: 'valores',
        mensagem: `Peça "${canonico}" não consta na linha ${linhaProduto || '—'} do catálogo. Confira a linha do produto.`,
        bloqueia: false
      });
      if (r.status === 'padronizada' && r.canonico) {
        peca.nome = r.canonico;
        if (r.linhaOk === false) linhaErrada(r.canonico);
        continue;
      }
      const chave = normalizarNome(r.original);
      if (r.status === 'revisar' && r.sugestao) {
        peca.nomeOriginal = r.original;
        peca.nome = r.sugestao;
        if (r.linhaOk === false) linhaErrada(r.sugestao);
        if (!item.pecasPadronizadas.some((p) => p.chave === chave)) {
          item.pecasPadronizadas.push({ chave, original: r.original, canonico: r.sugestao });
          item.pendencias.push({ campo: 'padrao', peca: chave, mensagem: avisoTrocada(r.original, r.sugestao), bloqueia: false });
        }
        continue;
      }
      if (item.pecasSemPadrao.some((p) => p.chave === chave)) continue;
      item.pecasSemPadrao.push({ chave, original: r.original });
      item.pendencias.push({ campo: 'padrao', peca: chave, mensagem: avisoSemPadrao(r.original), bloqueia: false });
    }
  }
};

export type GrupoSemPadrao = { chave: string; original: string; sugestao?: string; linhasProduto: string[]; linhasPlanilha: number[] };
export type GrupoPadronizado = { chave: string; original: string; canonico: string; desfeita: boolean; linhasPlanilha: number[] };

/** Pecas sem nada parecido no catalogo, uma vez por descricao (com as linhas da planilha e do produto). */
export const gruposSemPadrao = (itens: ItemOrcamentoPlanilha[]): GrupoSemPadrao[] => {
  const grupos = new Map<string, GrupoSemPadrao>();
  for (const item of itens) {
    for (const peca of item.pecasSemPadrao || []) {
      const grupo = grupos.get(peca.chave) || { chave: peca.chave, original: peca.original, sugestao: peca.sugestao, linhasProduto: [], linhasPlanilha: [] };
      const linha = item.produto?.linha;
      if (linha && !grupo.linhasProduto.includes(linha)) grupo.linhasProduto.push(linha);
      if (!grupo.linhasPlanilha.includes(item.linha)) grupo.linhasPlanilha.push(item.linha);
      grupos.set(peca.chave, grupo);
    }
  }
  return [...grupos.values()];
};

/** Pecas trocadas automaticamente pelo padrao parecido, uma vez por descricao. */
export const gruposPadronizados = (itens: ItemOrcamentoPlanilha[]): GrupoPadronizado[] => {
  const grupos = new Map<string, GrupoPadronizado>();
  for (const item of itens) {
    for (const peca of item.pecasPadronizadas || []) {
      const grupo = grupos.get(peca.chave) || { chave: peca.chave, original: peca.original, canonico: peca.canonico, desfeita: Boolean(peca.desfeita), linhasPlanilha: [] };
      if (!grupo.linhasPlanilha.includes(item.linha)) grupo.linhasPlanilha.push(item.linha);
      grupos.set(peca.chave, grupo);
    }
  }
  return [...grupos.values()];
};

/**
 * Desfaz (ou refaz) a troca automatica de uma descricao em todos os produtos do lote.
 * Desfeita, a peca volta ao nome digitado e passa a contar como "sem padrao" (pedido de padrao novo no envio).
 * Devolve itens novos (para o React re-renderizar).
 */
export const alternarPadronizacao = (itens: ItemOrcamentoPlanilha[], chave: string, desfazer: boolean) =>
  itens.map((item) => {
    const registro = item.pecasPadronizadas?.find((p) => p.chave === chave);
    if (!registro || Boolean(registro.desfeita) === desfazer) return item;
    const pecas = item.pecas.map((p) => (p.nomeOriginal && normalizarNome(p.nomeOriginal) === chave
      ? { ...p, nome: desfazer ? p.nomeOriginal : registro.canonico }
      : p));
    const pendencias = item.pendencias.filter((p) => !(p.campo === 'padrao' && p.peca === chave));
    pendencias.push({
      campo: 'padrao', peca: chave, bloqueia: false,
      mensagem: desfazer ? avisoSemPadrao(registro.original) : avisoTrocada(registro.original, registro.canonico)
    });
    const semPadrao = (item.pecasSemPadrao || []).filter((p) => p.chave !== chave);
    if (desfazer) semPadrao.push({ chave, original: registro.original });
    return {
      ...item, pecas, pendencias, pecasSemPadrao: semPadrao,
      pecasPadronizadas: item.pecasPadronizadas!.map((p) => (p.chave === chave ? { ...p, desfeita: desfazer } : p))
    };
  });

/**
 * Registra no catalogo o pedido de padrao novo de cada descricao desconhecida (chamado depois do envio).
 * Nunca derruba o envio: devolve quantos pedidos falharam e o motivo do primeiro.
 */
export const registrarPedidosPadraoNovo = async (
  grupos: GrupoSemPadrao[],
  contexto: { protocolo: string; paUsuario: string; cnpj: string }
) => {
  const resultados = await Promise.allSettled(grupos.map((grupo) => registrarDecisaoPadrao({
    tipo: 'SOLICITACAO', nomeOriginal: grupo.original, nomeSugerido: grupo.original, linha: grupo.linhasProduto[0], ...contexto
  })));
  const falha = resultados.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { falhas: resultados.filter((r) => r.status === 'rejected').length, motivo: falha ? mensagemErro(falha.reason) : '' };
};

/** Registra a decisao no catalogo: apelido (padrao existente) ou pedido de padrao novo. */
export const registrarDecisaoPadrao = async (dados: {
  tipo: 'ALIAS' | 'SOLICITACAO'; nomeOriginal: string; codigo?: string; nomeSugerido?: string; linha?: string;
  paUsuario: string; cnpj: string; protocolo: string;
}) => {
  const res = await oracleApi.post(ORACLE_ENDPOINTS.decisaoItemPadrao, dados, { headers: { 'Content-Type': 'application/json' } });
  if (res.data?.ok !== true) throw new Error('O catálogo não confirmou a padronização.');
  return res.data as { ok: true; codigo?: string; id?: number };
};

export type DadosEnvio = {
  protocolo: string;
  paUsuario: string;
  cnpj: string;
  razaoSocial: string;
  unidade: string;
  emailRetorno: string;
};

export type ResultadoEnvio = { status: 'ok'; salvos: number; comFoto: number; fotosNaoEnviadas: number; erroDrive: string };

const mensagemErroDrive = (error: unknown) => {
  const resposta = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof resposta === 'string') return resposta;
  return error instanceof Error ? error.message : 'Falha ao enviar ao Google Drive.';
};

type PostarSerial = (body: Record<string, unknown>) => Promise<{ itens?: { chave?: string; codigo?: string }[] }>;
const postarSerialPadrao: PostarSerial = async (body) =>
  (await oracleApi.post(ORACLE_ENDPOINTS.gerarSerialPeca, body, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 })).data;

/**
 * Pede ao banco o identificador das pecas sem serial e o grava como serial do item (formato do portal).
 * O banco devolve sempre o mesmo codigo para a mesma chave do item no mesmo lote: repetir nao gera outro.
 */
export const gerarIdentificadoresPeca = async (itens: ItemOrcamentoPlanilha[], base: Pick<DadosEnvio, 'protocolo' | 'paUsuario' | 'cnpj'>, postar: PostarSerial = postarSerialPadrao) => {
  const semSerial = itens.filter((item) => !item.serial);
  if (!semSerial.length) return;
  semSerial.forEach((item) => { item.chaveItem ||= novaChaveItem(); item.serialGerado = true; });
  const data = await postar({
    cnpj: base.cnpj, protocolo: base.protocolo, paUsuario: base.paUsuario,
    itens: semSerial.map((item) => ({ chave: item.chaveItem, notaFiscal: item.notaFiscal, codGemco: item.produto?.codGemco || item.codigo }))
  });
  const porChave = new Map((data?.itens || []).map((r) => [String(r.chave), String(r.codigo || '')]));
  for (const item of semSerial) {
    const codigo = porChave.get(item.chaveItem || '') || '';
    if (!/^SSAT\d{8,}$/.test(codigo)) throw new Error('O banco não devolveu o identificador de todas as peças sem serial.');
    item.serial = formatSerialValue(codigo);
    item.pendencias = item.pendencias.filter((p) => p.mensagem !== AVISO_SEM_SERIAL);
    item.pendencias.push({ campo: 'serial', mensagem: `Identificador gerado: ${item.serial}. Etiquete a peça com ele.`, bloqueia: false });
  }
};

/**
 * Trava final do envio: lote vazio, serial repetido no lote ou qualquer pendencia que bloqueia.
 * A tela ja impede o clique, mas a regra vale aqui tambem para nenhum caminho enviar lote inconsistente.
 */
export const validarLoteParaEnvio = (itens: ItemOrcamentoPlanilha[]) => {
  if (!itens.length) throw new ErroImportacao('O lote está vazio.');
  const repetidos = seriaisDuplicados(itens);
  if (repetidos.length) {
    throw new ErroImportacao(`Envio bloqueado: serial repetido no lote (${repetidos.map((r) => r.serial).join(', ')}). Cada serial só pode aparecer uma vez.`);
  }
  const inconsistencias = inconsistenciasDoLote(itens);
  if (inconsistencias.length) {
    throw new ErroImportacao(`Envio bloqueado: corrija ${inconsistencias.map((i) => `${i.titulo} (linha ${i.linhas.join(', ')})`).join('; ')}.`);
  }
};

/**
 * Cadastra o lote (registrar_lote_posto), salva os valores de cada item (fica em MONTAGEM)
 * e guarda os itens com avaria como rascunho para a foto em Lancar Orcamentos.
 * Reenviar os mesmos itens nao duplica. Lanca erro em falha de rede/servidor ou lote inconsistente.
 */
export const enviarLoteOrcamento = async (
  itens: ItemOrcamentoPlanilha[],
  base: DadosEnvio,
  onEtapa: (etapa: string) => void,
  envioEvidencias: typeof enviarEvidenciasDrive = enviarEvidenciasDrive,
  gerarIds: typeof gerarIdentificadoresPeca = gerarIdentificadoresPeca
): Promise<ResultadoEnvio> => {
  validarLoteParaEnvio(itens);
  const { protocolo, paUsuario, cnpj } = base;

  // 0. Peca sem serial recebe o identificador unico do banco (o mesmo em "Tentar novamente").
  if (itens.some((item) => !item.serial)) {
    onEtapa('Gerando identificadores das peças sem serial...');
    await gerarIds(itens, base);
    const repetidos = seriaisDuplicados(itens);
    if (repetidos.length) throw new ErroImportacao(`Envio bloqueado: o identificador ${repetidos[0].serial} já está em outra linha do lote.`);
  }
  const cadastros = new Map(itens.map((item) => [item, montarItemCadastro(item, protocolo)]));

  // 1. Cadastra o lote. Reenviar os mesmos itens nao duplica.
  onEtapa('Cadastrando o lote...');
  await oracleApi.post(ORACLE_ENDPOINTS.saveOrcamento, { ...base, itens: Array.from(cadastros.values()) }, {
    headers: { 'Content-Type': 'application/json' }
  });

  // 2. Busca os IDs gerados pelo banco para cada serial.
  onEtapa('Conferindo os itens cadastrados...');
  const res = await oracleApi.get(ORACLE_ENDPOINTS.getLancamentoDraftsSupabase, {
    params: { paUsuario, _ts: Date.now() },
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
  });
  const idPorSerial = new Map<string, number>();
  (Array.isArray(res.data) ? res.data : []).forEach((row: { oracle_item_id?: unknown; payload?: Record<string, unknown> }) => {
    if (row?.payload?.protocolo !== protocolo) return;
    const id = Number(row.oracle_item_id);
    if (id) idPorSerial.set(compactLookupValue(String(row.payload.serial || '')), id);
  });
  // Itens ausentes ja foram salvos numa tentativa anterior (sairam de RASCUNHO).
  const pendentes = itens
    .map((item) => ({ item, id: idPorSerial.get(compactLookupValue(item.serial)) }))
    .filter((entrada): entrada is { item: ItemOrcamentoPlanilha; id: number } => Boolean(entrada.id));

  // 3. Evidencias anexadas na conferencia vao para o Drive (uma pasta por produto).
  // O link fica no item: se o envio falhar depois, "Tentar novamente" nao sobe os arquivos de novo.
  // Foto so e obrigatoria em avaria estetica: se o Drive falhar, o item sem avaria segue sem foto
  // e o com avaria fica como rascunho aguardando a foto (passo 4). O envio do lote nao trava.
  const comEvidencia = pendentes.filter(({ item }) => item.evidencias?.length && !item.linkDrive);
  let fotosNaoEnviadas = 0;
  let erroDrive = '';
  for (const [indice, { item }] of comEvidencia.entries()) {
    onEtapa(`Enviando fotos e vídeos ao Drive: produto ${indice + 1} de ${comEvidencia.length}...`);
    const cadastro = cadastros.get(item);
    try {
      // Todas as evidencias do lote na mesma pasta do protocolo; o nome do arquivo diz o produto.
      item.linkDrive = await envioEvidencias(item.evidencias || [],
        { nome: nomePastaProtocolo(protocolo), prefixoArquivo: prefixoArquivoProduto(item.serial, cadastro?.codGemco || '') },
        (enviados, total) => onEtapa(`Enviando fotos e vídeos ao Drive: produto ${indice + 1} de ${comEvidencia.length} (${enviados}/${total} arquivos)...`));
    } catch (error) {
      fotosNaoEnviadas += 1;
      erroDrive ||= mensagemErroDrive(error);
      console.error('[envioOrcamento] evidencias nao enviadas', { serial: item.serial, avaria: item.avaria, erro: mensagemErroDrive(error) });
    }
  }

  // Avaria com evidencia ja anexada segue direto; sem evidencia continua como rascunho para a foto.
  const comValores = pendentes.filter(({ item }) => !item.avaria || item.linkDrive);
  const comFoto = pendentes.filter(({ item }) => item.avaria && !item.linkDrive);

  // 4. Salva os valores, como o botao de Lancar Orcamentos: o item fica em MONTAGEM.
  for (let inicio = 0; inicio < comValores.length; inicio += ITENS_POR_ENVIO) {
    onEtapa(`Salvando orçamentos: ${inicio} de ${comValores.length}...`);
    const lote = comValores.slice(inicio, inicio + ITENS_POR_ENVIO);
    await oracleApi.post(ORACLE_ENDPOINTS.syncOrcamentoSupabase, {
      ...base,
      itens: lote.map(({ item, id }) => ({
        id,
        itemId: id,
        ...cadastros.get(item),
        ...montarValoresOrcamento(item),
        // Mesmos campos de Lancar Orcamentos: o AT abre a pasta pelo link_drive.
        ...(item.linkDrive ? { linkDrive: item.linkDrive, link_drive: item.linkDrive, fotoNome: item.linkDrive } : {}),
        status: 8
      }))
    }, { headers: { 'Content-Type': 'application/json' } });
  }

  // Avaria precisa de foto: os valores ficam como rascunho em Lancar Orcamentos.
  for (const [indice, { item, id }] of comFoto.entries()) {
    onEtapa(`Guardando itens com avaria: ${indice} de ${comFoto.length}...`);
    await oracleApi.post(ORACLE_ENDPOINTS.saveLancamentoDraftSupabase, {
      oracleItemId: id,
      protocolo,
      paUsuario,
      cnpj,
      payload: { ...montarValoresOrcamento(item), protocolo, serial: item.serial, status: 0 }
    }, { headers: { 'Content-Type': 'application/json' } });
  }

  return {
    status: 'ok',
    salvos: itens.filter((item) => !item.avaria || item.linkDrive).length,
    comFoto: itens.filter((item) => item.avaria && !item.linkDrive).length,
    fotosNaoEnviadas,
    erroDrive
  };
};
