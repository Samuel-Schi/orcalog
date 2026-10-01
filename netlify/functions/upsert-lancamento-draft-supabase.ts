import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio';
import { handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  try {
    const body = parsed.value as Record<string, unknown>;
    // Clientes antigos tentavam limpar o rascunho depois de salvar valores.
    if (body?.status === 'FINALIZADO') return jsonResponse(200, { ok: true });
    return jsonResponse(200, await rpcLote('salvar_item_montagem', { p_confirmado: false, p_item: {
      oracle_item_id: String(body?.oracleItemId || ''), protocolo: body?.protocolo,
      pa_usuario: body?.paUsuario, cnpj: String(body?.cnpj || '').replace(/\D/g, ''), rascunho: body?.payload || {}
    } }));
  } catch (error) { return handleFunctionError(error); }
};
