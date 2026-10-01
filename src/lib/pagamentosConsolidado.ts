export type PagamentoItemRaw = {
  negociacao_aplicada?: boolean;
  id?: number | string | null;
  oracle_item_id?: number | string | null;
  protocolo?: string | null;
  cod_gemco?: string | null;
  descricao?: string | null;
  serial?: string | null;
  total_orcamento?: number | string | null;
  val_pecas?: number | string | null;
  val_access?: number | string | null;
  val_emb?: number | string | null;
  val_mao_obra?: number | string | null;
  val_hig?: number | string | null;
  valor_produtos_aprovado?: number | string | null;
  valor_servicos_aprovado?: number | string | null;
  notas_fiscais?: Array<{tipo?: string; valor?: number | string; arquivo_id?: string; url?: string; numero?: string; nome?: string}> | null;
  status?: number | string | null;
  status_text?: string | null;
  pagamento_status?: string | null;
  pagamento_referencia?: string | null;
  valor_pagamento?: number | string | null;
  kirk_numero?: string | null;
  nota_fiscal_numero?: string | null;
  nota_fiscal_nome?: string | null;
  nota_fiscal_drive_link?: string | null;
  nota_fiscal_enviada_em?: string | null;
  pagamento_solicitado_em?: string | null;
  pagamento_validacao_status?: string | null;
};

export type NegociacaoPagamentoRaw = {
  protocolo?: string | null;
  status?: string | null;
  negotiation_scope?: string | null;
  item_ids?: Array<number | string> | string | null;
  valor_proposto_at?: number | string | null;
};

export type PagamentoProtocolo = {
  protocolo: string;
  oracle_item_id: number | null;
  cod_gemco?: string;
  descricao?: string;
  serial?: string;
  total_protocolo: number;
  quantidade_itens: number;
  itens_aprovados: number;
  itens_reprovados: number;
  item_ids: number[];
  pagamento_status?: string;
  pagamento_referencia?: string;
  valor_pagamento?: number;
  kirk_numero?: string;
  nota_fiscal_numero?: string;
  nota_fiscal_nome?: string;
  nota_fiscal_drive_link?: string;
  nota_fiscal_enviada_em?: string;
  pagamento_solicitado_em?: string;
  pagamento_validacao_status?: string;
  produto_aprovado: number;
  servico_aprovado: number;
  produto_faturado: number;
  servico_faturado: number;
  produto_saldo: number;
  servico_saldo: number;
  notas_fiscais: NonNullable<PagamentoItemRaw['notas_fiscais']>;
  possui_nota_sem_valor: boolean;
};

const toNumber = (value: unknown): number | null => {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseItemIds = (value: NegociacaoPagamentoRaw['item_ids']): string[] => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const isAprovado = (item: PagamentoItemRaw) =>
  String(item.status_text || '').trim().toUpperCase() === 'APROVADO';

const isReprovado = (item: PagamentoItemRaw) =>
  String(item.status_text || '').trim().toUpperCase() === 'REPROVADO';

const latestPayment = (items: PagamentoItemRaw[]) =>
  [...items].sort((a, b) => {
    const aTime = Date.parse(String(a.nota_fiscal_enviada_em || a.pagamento_solicitado_em || ''));
    const bTime = Date.parse(String(b.nota_fiscal_enviada_em || b.pagamento_solicitado_em || ''));
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  }).find((item) => item.nota_fiscal_numero || item.nota_fiscal_drive_link || item.pagamento_status);

const totalAprovadoProtocolo = (items: PagamentoItemRaw[], negociacoes: NegociacaoPagamentoRaw[]) => {
  const aprovados = items.filter(isAprovado);
  // Novos acordos já têm rateio oficial persistido. Não reaplicar o valor coletivo.
  if (items.some(item => item.negociacao_aplicada)) {
    return aprovados.reduce((total,item) => total + Math.max(0,toNumber(item.total_orcamento) ?? 0),0);
  }
  const coveredByGroup = new Set<string>();
  const itemOverrides = new Map<string, number>();
  let totalColetivo = 0;

  for (const negociacao of negociacoes) {
    if (String(negociacao.status || '').trim().toUpperCase() !== 'ACEITA_POSTO') continue;
    const valorAceito = toNumber(negociacao.valor_proposto_at);
    if (valorAceito == null || valorAceito < 0) continue;

    const scope = String(negociacao.negotiation_scope || '').trim().toUpperCase();
    const ids = parseItemIds(negociacao.item_ids);

    if (scope === 'LOTE') {
      totalColetivo += valorAceito;
      const idsCobertos = ids.length ? ids : aprovados.map((item) => String(item.id || ''));
      idsCobertos.filter(Boolean).forEach((id) => coveredByGroup.add(id));
      continue;
    }

    if (scope === 'ITEM' && ids.length === 1) {
      itemOverrides.set(ids[0], valorAceito);
      continue;
    }

    if (scope === 'ITEM' && ids.length > 1) {
      totalColetivo += valorAceito;
      ids.forEach((id) => coveredByGroup.add(id));
    }
  }

  return aprovados.reduce((total, item) => {
    const id = String(item.id || '');
    if (id && coveredByGroup.has(id)) return total;
    const valor = (id && itemOverrides.get(id) != null) ? itemOverrides.get(id) : toNumber(item.total_orcamento);
    return total + Math.max(0, valor ?? 0);
  }, totalColetivo);
};

const notasUnicas = (items: PagamentoItemRaw[]) => {
  const unicas = new Map<string, NonNullable<PagamentoItemRaw['notas_fiscais']>[number]>();
  for (const item of items) for (const nota of item.notas_fiscais || []) {
    const chave = String(nota.arquivo_id || `${nota.tipo}|${nota.numero}|${nota.url || ''}`).trim();
    if (chave && !unicas.has(chave)) unicas.set(chave, nota);
  }
  return [...unicas.values()];
};
const valoresPorTipo = (items: PagamentoItemRaw[], tipo: 'PRODUTO' | 'SERVICO') => items.reduce((total, item) => {
  const oficial = tipo === 'PRODUTO' ? toNumber(item.valor_produtos_aprovado) : toNumber(item.valor_servicos_aprovado);
  if (oficial != null) return total + Math.max(0, oficial);
  const legado = tipo === 'PRODUTO'
    ? (toNumber(item.val_pecas) ?? 0) + (toNumber(item.val_access) ?? 0) + (toNumber(item.val_emb) ?? 0)
    : (toNumber(item.val_mao_obra) ?? 0) + (toNumber(item.val_hig) ?? 0);
  return total + Math.max(0, legado);
}, 0);

export const consolidarPagamentosPorProtocolo = (
  items: PagamentoItemRaw[],
  negociacoes: NegociacaoPagamentoRaw[] = []
): PagamentoProtocolo[] => {
  const grupos = new Map<string, PagamentoItemRaw[]>();

  for (const item of items) {
    const protocolo = String(item.protocolo || '').trim();
    if (!protocolo) continue;
    grupos.set(protocolo, [...(grupos.get(protocolo) || []), item]);
  }

  return [...grupos.entries()].map(([protocolo, grupo]) => {
    const negociacoesProtocolo = negociacoes.filter((negociacao) => String(negociacao.protocolo || '').trim() === protocolo);
    const principal = grupo[0];
    const pagamento = latestPayment(grupo);
    const itemIds = grupo
      .map((item) => toNumber(item.oracle_item_id))
      .filter((id): id is number => id != null);

    const valorPagamento = toNumber(pagamento?.valor_pagamento);
    const notas = notasUnicas(grupo);
    const produtoAprovado = Number(valoresPorTipo(grupo, 'PRODUTO').toFixed(2));
    const servicoAprovado = Number(valoresPorTipo(grupo, 'SERVICO').toFixed(2));
    const produtoFaturado = Number(notas.filter(nota => String(nota.tipo).toUpperCase() === 'PRODUTO').reduce((total, nota) => total + (toNumber(nota.valor) ?? 0), 0).toFixed(2));
    const servicoFaturado = Number(notas.filter(nota => String(nota.tipo).toUpperCase() === 'SERVICO').reduce((total, nota) => total + (toNumber(nota.valor) ?? 0), 0).toFixed(2));
    return {
      protocolo,
      oracle_item_id: itemIds[0] ?? null,
      cod_gemco: String(principal?.cod_gemco || ''),
      descricao: grupo.length > 1 ? `${grupo.length} itens finalizados` : String(principal?.descricao || principal?.cod_gemco || ''),
      serial: grupo.length > 1 ? '' : String(principal?.serial || ''),
      total_protocolo: Number(totalAprovadoProtocolo(grupo, negociacoesProtocolo).toFixed(2)),
      quantidade_itens: grupo.length,
      itens_aprovados: grupo.filter(isAprovado).length,
      itens_reprovados: grupo.filter(isReprovado).length,
      item_ids: itemIds,
      pagamento_status: String(pagamento?.pagamento_status || 'AGUARDANDO_NOTA'),
      pagamento_referencia: String(pagamento?.pagamento_referencia || ''),
      valor_pagamento: valorPagamento ?? undefined,
      kirk_numero: String(pagamento?.kirk_numero || ''),
      nota_fiscal_numero: String(pagamento?.nota_fiscal_numero || ''),
      nota_fiscal_nome: String(pagamento?.nota_fiscal_nome || ''),
      nota_fiscal_drive_link: String(pagamento?.nota_fiscal_drive_link || ''),
      nota_fiscal_enviada_em: String(pagamento?.nota_fiscal_enviada_em || ''),
      pagamento_solicitado_em: String(pagamento?.pagamento_solicitado_em || ''),
      pagamento_validacao_status: String(pagamento?.pagamento_validacao_status || ''),
      produto_aprovado: produtoAprovado, servico_aprovado: servicoAprovado,
      produto_faturado: produtoFaturado, servico_faturado: servicoFaturado,
      produto_saldo: Number(Math.max(0, produtoAprovado - produtoFaturado).toFixed(2)),
      servico_saldo: Number(Math.max(0, servicoAprovado - servicoFaturado).toFixed(2)),
      notas_fiscais: notas, possui_nota_sem_valor: notas.some(nota => toNumber(nota.valor) == null)
    };
  }).sort((a, b) => a.protocolo.localeCompare(b.protocolo, 'pt-BR'));
};
