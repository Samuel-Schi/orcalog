/*
 * Padronizacao de nome de peca contra o catalogo canonico (item_padrao / item_alias / item_padrao_linha).
 *
 * Objetivo: ao subir a planilha de orcamento, cada nome de peca digitado "torto" vira o nome CANONICO
 * do catalogo, para relatorio e padrao. O VALOR nunca passa por aqui (varia por posto, fica no lancamento).
 *
 * Performance: o catalogo e indexado UMA vez em Maps (match O(1) por nome/alias). O fuzzy so roda quando
 * nao houve acerto exato nem por alias, e percorre a lista de canonicos (poucas centenas).
 *
 * Seguranca de valor: so "padronizada" (exato/alias) e automatico. Granularidade diferente ou semelhanca
 * alta viram "revisar" (exige confirmacao humana) e nome desconhecido vira "nova". Nunca reescreve calado.
 */

export type ItemPadrao = { codigo: string; nomeCanonico: string; tipo: string };
export type PadraoLinhaRow = { codigo: string; linha: string };
export type AliasRow = { codigo: string; alias?: string; aliasNorm?: string };

export type CatalogoPadrao = {
  porNome: Map<string, ItemPadrao>;            // nome_norm  -> canonico
  porAlias: Map<string, ItemPadrao>;           // alias_norm -> canonico
  linhasPorCodigo: Map<string, Set<string>>;   // codigo     -> conjunto de linhas (normalizadas)
  lista: ItemPadrao[];                         // para o fallback fuzzy
};

export type StatusPeca = 'padronizada' | 'revisar' | 'nova';

export type ResultadoPeca = {
  original: string;
  canonico: string | null;
  codigo: string | null;
  status: StatusPeca;
  // true/false quando ha linha do produto e peca canonica; null quando nao da para avaliar.
  linhaOk: boolean | null;
  // preenchido em "revisar": o canonico sugerido que precisa de confirmacao.
  sugestao?: string;
  motivo?: string;
};

// Mesma normalizacao usada no seed SQL: NFD, remove acento, maiuscula, colapsa espaco.
export const normalizarNome = (valor: string | null | undefined) =>
  (valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export const indexarCatalogo = (
  padroes: ItemPadrao[],
  linhas: PadraoLinhaRow[],
  aliases: AliasRow[]
): CatalogoPadrao => {
  const porCodigo = new Map<string, ItemPadrao>();
  const porNome = new Map<string, ItemPadrao>();
  for (const p of padroes) {
    porCodigo.set(p.codigo, p);
    const chave = normalizarNome(p.nomeCanonico);
    if (chave && !porNome.has(chave)) porNome.set(chave, p);
  }

  const porAlias = new Map<string, ItemPadrao>();
  for (const a of aliases) {
    const canonico = porCodigo.get(a.codigo);
    if (!canonico) continue;
    const chave = a.aliasNorm ? normalizarNome(a.aliasNorm) : normalizarNome(a.alias);
    // Nao deixa um alias apontar para canonico diferente do nome exato ja mapeado.
    if (chave && !porNome.has(chave) && !porAlias.has(chave)) porAlias.set(chave, canonico);
  }

  const linhasPorCodigo = new Map<string, Set<string>>();
  for (const l of linhas) {
    const chave = normalizarNome(l.linha);
    if (!chave) continue;
    const set = linhasPorCodigo.get(l.codigo) ?? new Set<string>();
    set.add(chave);
    linhasPorCodigo.set(l.codigo, set);
  }

  return { porNome, porAlias, linhasPorCodigo, lista: padroes };
};

// Formato devolvido pelo endpoint /item_padrao.
export type CatalogoPadraoApi = {
  padroes?: ItemPadrao[];
  linhas?: PadraoLinhaRow[];
  aliases?: AliasRow[];
};

export const indexarCatalogoApi = (payload: CatalogoPadraoApi | null | undefined): CatalogoPadrao =>
  indexarCatalogo(payload?.padroes ?? [], payload?.linhas ?? [], payload?.aliases ?? []);

// Distancia de Levenshtein (nomes curtos; so roda no fallback).
const levenshtein = (a: string, b: string) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  let atual = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    atual[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
    }
    [anterior, atual] = [atual, anterior];
  }
  return anterior[b.length];
};

const similaridade = (a: string, b: string) => {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
};

// Acima disso, sugere o canonico mais parecido para confirmacao humana.
const LIMIAR_FUZZY = 0.84;

const avaliarLinha = (
  codigo: string,
  catalogo: CatalogoPadrao,
  linhaProduto: string | null | undefined
): boolean | null => {
  const linhaNorm = normalizarNome(linhaProduto);
  if (!linhaNorm) return null;
  const linhas = catalogo.linhasPorCodigo.get(codigo);
  if (!linhas || linhas.size === 0) return null;
  return linhas.has(linhaNorm);
};

/**
 * Padroniza um nome de peca. `linhaProduto` (vinda do gemco, ex.: "ED1 - ELETRO 1") liga o guarda de linha.
 */
export const padronizarPeca = (
  nome: string,
  catalogo: CatalogoPadrao,
  linhaProduto?: string | null
): ResultadoPeca => {
  const original = (nome || '').trim();
  const norm = normalizarNome(original);
  if (!norm) {
    return { original, canonico: null, codigo: null, status: 'nova', linhaOk: null, motivo: 'Nome vazio.' };
  }

  // 1) exato  2) alias  -> automatico
  const exato = catalogo.porNome.get(norm) ?? catalogo.porAlias.get(norm);
  if (exato) {
    return {
      original,
      canonico: exato.nomeCanonico,
      codigo: exato.codigo,
      status: 'padronizada',
      linhaOk: avaliarLinha(exato.codigo, catalogo, linhaProduto)
    };
  }

  // 3) granularidade (um contem o outro) e 4) fuzzy -> revisar
  let melhor: { item: ItemPadrao; score: number } | null = null;
  for (const item of catalogo.lista) {
    const alvo = normalizarNome(item.nomeCanonico);
    const contido = alvo.includes(norm) || norm.includes(alvo);
    const score = contido ? Math.max(0.9, similaridade(norm, alvo)) : similaridade(norm, alvo);
    if (!melhor || score > melhor.score) melhor = { item, score };
  }

  if (melhor && melhor.score >= LIMIAR_FUZZY) {
    return {
      original,
      canonico: null,
      codigo: null,
      status: 'revisar',
      linhaOk: avaliarLinha(melhor.item.codigo, catalogo, linhaProduto),
      sugestao: melhor.item.nomeCanonico,
      motivo: `Parecido com "${melhor.item.nomeCanonico}" — confirme antes de padronizar.`
    };
  }

  // 5) desconhecida
  return {
    original,
    canonico: null,
    codigo: null,
    status: 'nova',
    linhaOk: null,
    motivo: 'Peça não encontrada no catálogo padrão.'
  };
};
