import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody
} from './_shared';

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
    const tableName = String(process.env.SUPABASE_ORCAMENTOS_NEGOCIACOES_TABLE || 'orcamento_negociacoes').trim();

    if (!supabaseUrl || !supabaseSecret) {
      return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });
    }

    const parsedBody = parseJsonBody(event);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const payload = parsedBody.value as {
      protocolo?: string;
      action?: 'ACEITAR' | 'RECUSAR' | 'CONTRAPROPOSTA';
      valorContraproposta?: number | string;
      observacaoPosto?: string;
      respondidoPor?: string;
    };

    const protocolo = String(payload.protocolo || '').trim();
    const action = String(payload.action || '').trim().toUpperCase();
    const valorContraproposta = Number(payload.valorContraproposta ?? 0);
    const observacaoPosto = String(payload.observacaoPosto || '').trim();
    const respondidoPor = String(payload.respondidoPor || '').trim();

    if (!protocolo) {
      return jsonResponse(400, { error: 'protocolo e obrigatorio.' });
    }

    if (!['ACEITAR', 'RECUSAR', 'CONTRAPROPOSTA'].includes(action)) {
      return jsonResponse(400, { error: 'acao invalida.' });
    }

    if (action === 'CONTRAPROPOSTA' && (!Number.isFinite(valorContraproposta) || valorContraproposta <= 0)) {
      return jsonResponse(400, { error: 'valorContraproposta invalido.' });
    }

    const normalizedSupabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    const url = new URL(`${normalizedSupabaseUrl}/rest/v1/${tableName}`);
    url.searchParams.set('protocolo', `eq.${protocolo}`);

    const body =
      action === 'ACEITAR'
        ? {
            status: 'ACEITA_POSTO',
            acao_pendente_de: 'AT',
            observacao_posto: observacaoPosto,
            respondido_por: respondidoPor,
            updated_at: new Date().toISOString()
          }
        : action === 'RECUSAR'
          ? {
              status: 'RECUSADA_POSTO',
              acao_pendente_de: 'AT',
              observacao_posto: observacaoPosto,
              respondido_por: respondidoPor,
              updated_at: new Date().toISOString()
            }
          : {
              status: 'CONTRAPROPOSTA_POSTO',
              acao_pendente_de: 'AT',
              valor_contraproposta_posto: valorContraproposta,
              observacao_posto: observacaoPosto,
              respondido_por: respondidoPor,
              updated_at: new Date().toISOString()
            };

    const response = await fetchWithTimeout(url.toString(), {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: supabaseSecret,
        Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    if (!response.ok) {
      return jsonResponse(response.status, {
        error: 'Falha ao responder negociacao no Supabase.',
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
