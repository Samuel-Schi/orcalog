import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, sanitizeIdentifier, trimText } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as Record<string, unknown>;
    const itemId = Number(body.oracleItemId);
    const driveLink = trimText(body.notaFiscalDriveLink, 1000);
    const fileName = trimText(body.notaFiscalNome, 180);
    if (!Number.isFinite(itemId) || itemId <= 0 || !driveLink || !fileName) {
      return jsonResponse(400, { error: 'Item e nota fiscal são obrigatórios.' });
    }

    const supabaseUrl = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').trim();
    const supabaseSecret = String(process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const tableName = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados', 'orcamentos_finalizados');
    if (!supabaseUrl || !supabaseSecret) return jsonResponse(500, { error: 'Variáveis do Supabase não configuradas.' });

    const baseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    const response = await fetchWithTimeout(`${baseUrl}/rest/v1/${tableName}?oracle_item_id=eq.${encodeURIComponent(String(itemId))}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        pagamento_status: 'NOTA_ENVIADA',
        pagamento_referencia: trimText(body.pagamentoReferencia, 120),
        nota_fiscal_nome: fileName,
        nota_fiscal_drive_link: driveLink,
        nota_fiscal_enviada_em: new Date().toISOString(),
        pagamento_solicitado_em: new Date().toISOString()
      })
    });
    const text = await response.text();
    if (!response.ok) return jsonResponse(response.status, { error: 'Falha ao salvar a nota fiscal no Supabase.', detail: text || null });
    return { statusCode: 200, body: text, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } };
  } catch (error) {
    return handleFunctionError(error);
  }
};
