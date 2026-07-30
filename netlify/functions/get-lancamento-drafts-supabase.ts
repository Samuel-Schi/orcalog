import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  jsonResponse,
  methodNotAllowed,
  sanitizeIdentifier,
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
    const tableName = sanitizeIdentifier(
      process.env.SUPABASE_ORCAMENTOS_LANCAMENTO_DRAFT_TABLE || 'orcamento_lancamento_rascunhos',
      'orcamento_lancamento_rascunhos'
    );

    if (!supabaseUrl || !supabaseSecret) {
      return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });
    }

    const params = sanitizeQueryParams(event.queryStringParameters);
    const paUsuario = String(params.get('paUsuario') || params.get('pa_usuario') || '').trim();
    if (!paUsuario) {
      return jsonResponse(400, { error: 'paUsuario e obrigatorio.' });
    }

    const normalizedSupabaseUrl = supabaseUrl
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/$/, '');

    const url = new URL(`${normalizedSupabaseUrl}/rest/v1/${tableName}`);
    url.searchParams.set('select', 'oracle_item_id,status,payload,atualizado_em');
    url.searchParams.set('pa_usuario', `eq.${paUsuario}`);
    url.searchParams.set('status', 'eq.RASCUNHO');
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
        error: 'Falha ao consultar rascunhos de lancamento no Supabase.',
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
