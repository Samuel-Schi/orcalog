import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, sanitizeIdentifier, sanitizeQueryParams } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);

    const supabaseUrl = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').trim();
    const supabaseSecret = String(process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const tableName = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados', 'orcamentos_finalizados');
    if (!supabaseUrl || !supabaseSecret) return jsonResponse(500, { error: 'Variáveis do Supabase não configuradas.' });

    const params = sanitizeQueryParams(event.queryStringParameters);
    const cnpj = String(params.get('cnpj') || '').replace(/\D/g, '');
    if (!cnpj) return jsonResponse(400, { error: 'CNPJ é obrigatório.' });

    const baseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    const url = new URL(`${baseUrl}/rest/v1/${tableName}`);
    url.searchParams.set('select', 'oracle_item_id,protocolo,cod_gemco,descricao,serial,total_orcamento,pagamento_status,pagamento_referencia,nota_fiscal_nome,nota_fiscal_drive_link,nota_fiscal_enviada_em,pagamento_solicitado_em');
    url.searchParams.set('cnpj', `eq.${cnpj}`);
    url.searchParams.set('order', 'atualizado_em.desc');
    url.searchParams.set('limit', '500');

    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
    });
    const text = await response.text();
    if (!response.ok) return jsonResponse(response.status, { error: 'Falha ao consultar pagamentos.', detail: text || null });
    return { statusCode: 200, body: text, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } };
  } catch (error) {
    return handleFunctionError(error);
  }
};
