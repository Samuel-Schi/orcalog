import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const createNotificationsHandler = (env: Record<string, string | undefined>): Handler => async (event) => {
  try {
    if (!['GET', 'POST'].includes(event.httpMethod)) return methodNotAllowed(['GET', 'POST']);
    let body: Record<string, unknown> = {};
    if (event.httpMethod === 'POST') {
      const parsed = parseJsonBody(event);
      if (!parsed.ok) return parsed.response;
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        return jsonResponse(400, { error: 'Dados inválidos.' });
      }
      body = parsed.value as Record<string, unknown>;
    }
    const cnpj = String(event.httpMethod === 'GET' ? event.queryStringParameters?.cnpj || '' : body.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return jsonResponse(400, { error: 'Informe o CNPJ do posto.' });
    const base = (env.SUPABASE_ORCAMENTOS_URL || env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    const key = env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return jsonResponse(500, { error: 'Serviço de notificações não configurado.' });
    const url = new URL(base + '/rest/v1/notificacoes_pa');
    url.searchParams.set('cnpj', 'eq.' + cnpj);
    const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
    if (event.httpMethod === 'GET') {
      url.searchParams.set('select', 'id,protocolo,tipo,mensagem,criado_em,lida_em');
      url.searchParams.set('lida_em', 'is.null');
      url.searchParams.set('order', 'id.desc');
      url.searchParams.set('limit', '100');
    } else {
      const id = String(body.id || '');
      if (!/^[1-9]\d*$/.test(id)) return jsonResponse(400, { error: 'Notificação inválida.' });
      url.searchParams.set('id', 'eq.' + id);
      url.searchParams.set('lida_em', 'is.null');
    }
    const response = await fetchWithTimeout(url.toString(), {
      method: event.httpMethod === 'GET' ? 'GET' : 'PATCH', headers,
      ...(event.httpMethod === 'POST' ? { body: JSON.stringify({ lida_em: new Date().toISOString() }) } : {})
    });
    const texto = await response.text();
    if (!response.ok) {
      return jsonResponse(503, {
        error: 'Não foi possível consultar ou atualizar os avisos. Tente novamente.',
        detail: texto.slice(0, 300)
      });
    }
    if (!texto.trim()) return jsonResponse(200, []);
    try {
      return jsonResponse(200, JSON.parse(texto));
    } catch {
      return jsonResponse(502, { error: 'Resposta inválida do serviço de notificações.' });
    }
  } catch (error) { return handleFunctionError(error); }
};
export const handler = createNotificationsHandler(process.env);
