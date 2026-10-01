import { fetchWithTimeout } from './_shared';

const origem = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/';
export async function idsDoLote(cnpj: string, protocolo: string): Promise<string[]> {
  const ids = new Set<string>();
  // Une enviados e itens aguardando lançamento: a fila de análise nunca deve
  // presumir que a listagem de enviados contém os itens ainda não enviados.
  for (const endpoint of ['get_envios', 'get_orcamentos_analise']) {
  const paginas = new Set<string>();
  const idsFonte = new Set<string>();
  let terminou = false;
  for (let offset = 0; offset < 200000; offset += 200) {
    const url = new URL(endpoint, origem);
    url.searchParams.set('cnpj', cnpj);
    url.searchParams.set('limit', '200');
    url.searchParams.set('offset', String(offset));
    const response = await fetchWithTimeout(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Não foi possível conferir todos os itens do lote no Oracle.');
    const data = await response.json();
    const rows = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(rows)) throw new Error('Lista de itens inválida. Lote não liberado.');
    const assinatura = JSON.stringify(rows);
    if (rows.length && paginas.has(assinatura)) throw new Error('Paginação repetida; lote não liberado.');
    paginas.add(assinatura);
    for (const row of rows) {
      if (String(row.protocolo ?? row.PROTOCOLO ?? '').trim() !== protocolo) continue;
      const id = String(row.id ?? row.ID ?? row.oracle_item_id ?? '').trim();
      if (!/^\d+$/.test(id) || idsFonte.has(id)) throw new Error('Identificação dos itens inconsistente.');
      idsFonte.add(id);
      ids.add(id);
    }
    const temProxima = Array.isArray(data.links) && data.links.some((link: {rel?:string}) => link.rel === 'next');
    if (data.hasMore === false || (data.hasMore == null && !temProxima && rows.length < 200)) { terminou = true; break; }
    if (!rows.length) throw new Error('Paginação incompleta; lote não liberado.');
  }
  if (!terminou) throw new Error('Limite de consulta excedido; lote não liberado.');
  }
  return [...ids];
}

export function configuracaoLote() {
  const base = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/i,'').replace(/\/$/,'');
  const key = process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase não configurado.');
  if (process.env.SUPABASE_ORCAMENTOS_TABLE && process.env.SUPABASE_ORCAMENTOS_TABLE !== 'orcamentos_finalizados') throw new Error('RPC configurada para tabela diferente.');
  return { base, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

export async function rpcLote(nome: string, payload: Record<string, unknown>) {
  const {base,headers} = configuracaoLote();
  const response = await fetchWithTimeout(`${base}/rest/v1/rpc/${nome}`, { method:'POST',headers,body:JSON.stringify(payload) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || 'Falha ao atualizar lote. Confira a migração de envio seguro.');
  }
  return response.json();
}

export async function concluirLote(cnpj: string, protocolo: string) {
  const ids = await idsDoLote(cnpj, protocolo);
  if (!ids.length) throw new Error('Lote não encontrado no Oracle.');
  return rpcLote('concluir_envio_lote', { p_protocolo: protocolo, p_cnpj: cnpj, p_ids: ids });
}
