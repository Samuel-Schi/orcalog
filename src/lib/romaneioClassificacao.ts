// Romaneio separado por classificacao: Saldo A, depois reprovados, depois o resto.
// Orcamento reprovado vai para REPROVADO mesmo com outra classificacao (mesma regra do
// Recebimento PA do RMS, recebimentoPaApi.ts -> tipoOrcamentoPaDoRavenas).
type ItemClassificavel = { tipoOrc?: string | null; statusText?: string | null };

export const SEM_CLASSIFICACAO = 'SEM CLASSIFICACAO';
const ORDEM = ['SALDO A', 'REPROVADO', 'NOVO', 'GARANTIA', 'SUCATA'];

const normalizar = (valor?: string | null) =>
  String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

export const classificacaoRomaneio = (item: ItemClassificavel) => {
  if (normalizar(item.statusText) === 'REPROVADO') return 'REPROVADO';
  return normalizar(item.tipoOrc) || SEM_CLASSIFICACAO;
};

const posicao = (classificacao: string) => {
  if (classificacao === SEM_CLASSIFICACAO) return Number.MAX_SAFE_INTEGER;
  const indice = ORDEM.indexOf(classificacao);
  return indice === -1 ? ORDEM.length : indice;
};

/** Grupos na ordem do romaneio; dentro de cada grupo os itens mantem a ordem original. */
export const agruparPorClassificacao = <T extends ItemClassificavel>(itens: T[]) => {
  const grupos = new Map<string, T[]>();
  itens.forEach((item) => {
    const classificacao = classificacaoRomaneio(item);
    grupos.set(classificacao, [...(grupos.get(classificacao) || []), item]);
  });
  return Array.from(grupos, ([classificacao, itensGrupo]) => ({ classificacao, itens: itensGrupo }))
    .sort((a, b) => posicao(a.classificacao) - posicao(b.classificacao) || a.classificacao.localeCompare(b.classificacao));
};

export const tituloGrupo = (classificacao: string, quantidade: number) =>
  `${classificacao === 'REPROVADO' ? 'REPROVADOS' : classificacao} - ${quantidade === 1 ? '1 item' : `${quantidade} itens`}`;
