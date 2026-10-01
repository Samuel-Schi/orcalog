import { fetchWithTimeout } from './_shared';

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
  // RPCs que retornam void recebem 204 sem corpo no PostgREST. A leitura
  // abaixo evita que uma resposta vazia interrompa o envio com erro de JSON.
  const texto = await response.text();
  let resultado: unknown = null;
  if (texto.trim()) {
    try {
      resultado = JSON.parse(texto);
    } catch {
      resultado = texto;
    }
  }
  if (!response.ok) {
    const erro = resultado && typeof resultado === 'object'
      ? resultado as { message?: unknown }
      : null;
    throw new Error(
      typeof erro?.message === 'string'
        ? erro.message
        : texto || 'Falha ao atualizar lote. Confira a configuracao de envio seguro.'
    );
  }
  return resultado;
}

export async function concluirLote(cnpj: string, protocolo: string, ids: string[]) {
  if (!ids.length) throw new Error('Informe os itens esperados do lote.');
  return rpcLote('concluir_envio_lote', { p_protocolo: protocolo, p_cnpj: cnpj, p_ids: ids });
}
