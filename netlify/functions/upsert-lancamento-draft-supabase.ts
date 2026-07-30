import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
  sanitizeIdentifier,
  trimText
} from './_shared';

type DraftPayload = {
  paUsuario?: string;
  oracleItemId?: number;
  protocolo?: string;
  cnpj?: string;
  status?: string;
  payload?: Record<string, unknown>;
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return methodNotAllowed(['POST']);
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

    const parsedBody = parseJsonBody(event);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const body = parsedBody.value as DraftPayload;
    const paUsuario = trimText(body.paUsuario || '', 80);
    const oracleItemId = Number(body.oracleItemId || 0);
    if (!paUsuario || !oracleItemId) {
      return jsonResponse(400, { error: 'paUsuario e oracleItemId sao obrigatorios.' });
    }

    const record = {
      pa_usuario: paUsuario,
      oracle_item_id: oracleItemId,
      protocolo: trimText(body.protocolo || '', 80),
      cnpj: trimText(body.cnpj || '', 20),
      status: trimText(body.status || 'RASCUNHO', 30) || 'RASCUNHO',
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {}
    };

    const normalizedSupabaseUrl = supabaseUrl
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/$/, '');

    const restUrl = `${normalizedSupabaseUrl}/rest/v1/${tableName}?on_conflict=${encodeURIComponent('pa_usuario,oracle_item_id')}`;
    const response = await fetchWithTimeout(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseSecret,
        Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify([record])
    });

    const text = await response.text();
    if (!response.ok) {
      return jsonResponse(response.status, {
        error: 'Falha ao salvar rascunho de lancamento no Supabase.',
        detail: text || null
      });
    }

    return {
      statusCode: response.status,
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
