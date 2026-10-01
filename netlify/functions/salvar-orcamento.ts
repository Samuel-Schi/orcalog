import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio';
import { buildRecord, type SyncPayload } from './sync-orcamento-supabase';
import { handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  try {
    const body = parsed.value as SyncPayload;
    if (!Array.isArray(body?.itens) || !body.itens.length) return jsonResponse(400, { error: 'Informe os produtos do lote.' });
    // O banco gera IDs; o valor abaixo serve apenas para normalizar o cadastro.
    const itens = body.itens.map((item) => buildRecord(body, { ...item, itemId: 1 }));
    return jsonResponse(200, await rpcLote('registrar_lote_posto', { p_itens: itens }));
  } catch (error) { return handleFunctionError(error); }
};
