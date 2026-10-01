import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, proxyResponse } from './_shared';
import { rpcLote } from './_lote-envio';

const URL =
  process.env.ORACLE_LANCAR_VALORES_URL ||
  'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/update_valores';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as {protocolo?:string;cnpj?:string;itens?:Array<{id?:number;itemId?:number}>};
    if (!body?.protocolo || !body.cnpj || body.itens?.length !== 1 || !(body.itens[0].itemId ?? body.itens[0].id)) return jsonResponse(400,{error:'Informe um item, protocolo e posto válidos.'});
    // Retira o lote da fila ANTES da escrita no Oracle. Em caso de falha,
    // permanece bloqueado até o reenvio, sem permitir análise de dados parciais.
    await rpcLote('iniciar_lancamento_posto',{p_protocolo:body.protocolo,p_cnpj:body.cnpj,p_id:String(body.itens[0].itemId ?? body.itens[0].id)});
    const res = await fetchWithTimeout(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: event.body || '{}'
    });

    return proxyResponse(res);
  } catch (err) {
    return handleFunctionError(err);
  }
};
