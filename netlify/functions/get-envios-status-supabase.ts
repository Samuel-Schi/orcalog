import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  jsonResponse,
  methodNotAllowed,
  sanitizeQueryParams
} from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    const supabaseUrl = String(
      process.env.SUPABASE_ORCAMENTOS_URL ||
      process.env.SUPABASE_URL ||
      ''
    ).trim();
    const supabaseSecret = String(
      process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ''
    ).trim();
    const tableName = String(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados').trim();

    if (!supabaseUrl || !supabaseSecret) {
      return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });
    }

    const params = sanitizeQueryParams(event.queryStringParameters);
    const cnpj = String(params.get('cnpj') || '').trim();
    if (!cnpj) {
      return jsonResponse(400, { error: 'cnpj e obrigatorio.' });
    }

    const normalizedSupabaseUrl = supabaseUrl
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/$/, '');

    const url = new URL(`${normalizedSupabaseUrl}/rest/v1/${tableName}`);
    url.searchParams.set('select', 'oracle_item_id,protocolo,cod_gemco,cod_barras,serial,status');
    url.searchParams.set('cnpj', `eq.${cnpj}`);
    url.searchParams.set('order', 'atualizado_em.desc');
    url.searchParams.set('limit', '500');

    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: supabaseSecret,
        Authorization: `Bearer ${supabaseSecret}`
      }
    });

    const text = await response.text();
    if (!response.ok) {
      return jsonResponse(response.status, {
        error: 'Falha ao consultar status no Supabase.',
        detail: text || null
      });
    }

    return {
      statusCode: 200,
      body: text,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    };
  } catch (err) {
    return handleFunctionError(err);
  }
};
