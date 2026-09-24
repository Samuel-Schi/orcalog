export type ItemResultado = {
  supabaseId?: string;
  status: number;
  statusText?: string | null;
  totalOrcamento?: number;
};

export type NegociacaoResultado = {
  status?: string | null;
  negotiation_scope?: string | null;
  item_ids?: string[] | null;
  valor_proposto_at?: number | string | null;
  valor_contraproposta_posto?: number | string | null;
};

export const resultadoItem = (item: ItemResultado) => {
  const decisao = String(item.statusText || '').trim().toUpperCase();
  if (decisao === 'REPROVADO') return 'Reprovado';
  if (decisao === 'APROVADO') return 'Aprovado';
  return 'Aguardando análise';
};

export const valorAceito = (negociacao: NegociacaoResultado): number | null => {
  // Uma contraproposta enviada ainda nao representa um acordo fechado.
  const status = String(negociacao.status || '').trim().toUpperCase();
  const raw = status === 'ACEITA_POSTO' ? negociacao.valor_proposto_at : null;
  if (raw == null || String(raw).trim() === '') return null;
  const valor = Number(raw);
  return Number.isFinite(valor) && valor >= 0 ? valor : null;
};

export const negociacaoDoItem = (item: ItemResultado, negociacao?: NegociacaoResultado) =>
  Boolean(negociacao && (
    negociacao.negotiation_scope === 'LOTE' ||
    (item.supabaseId && negociacao.item_ids?.map(String).includes(item.supabaseId))
  ));

export const valorFinalItem = (item: ItemResultado, negociacao?: NegociacaoResultado): number | null => {
  const resultado = resultadoItem(item);
  if (resultado === 'Reprovado') return 0;
  if (resultado !== 'Aprovado') return null;
  if (negociacao && negociacaoDoItem(item, negociacao)) {
    // O valor de um lote ou de varios itens nao pode ser repetido em cada linha.
    if (negociacao.negotiation_scope !== 'ITEM' || negociacao.item_ids?.length !== 1) return null;
    return valorAceito(negociacao);
  }
  return item.totalOrcamento ?? null;
};
