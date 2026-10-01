import type { Handler } from '@netlify/functions';
import { handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as {protocolo?:string;cnpj?:string;itens?:Array<{id?:number;itemId?:number}>};
    if (!body?.protocolo || !body.cnpj || body.itens?.length !== 1 || !(body.itens[0].itemId ?? body.itens[0].id)) return jsonResponse(400,{error:'Informe um item, protocolo e posto válidos.'});
    // A gravacao e feita exclusivamente pela proxima chamada
    // /sync_orcamento_supabase. Esta rota apenas preserva o contrato da tela.
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return handleFunctionError(err);
  }
};
