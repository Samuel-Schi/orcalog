import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio';
import { jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;

  try {
    const acao = String(body?.acao || '');
    const protocolo = String(body?.protocolo || '').trim();
    const cnpj = String(body?.cnpj || '').replace(/\D/g, '');
    if (!['CONCLUIR', 'CANCELAR'].includes(acao) || !protocolo || cnpj.length !== 14) {
      return jsonResponse(400, { error: 'Dados do lote invalidos.' });
    }

    if (acao === 'CONCLUIR') {
      const completo = await rpcLote('finalizar_montagem_posto', { p_protocolo: protocolo, p_cnpj: cnpj });
      return jsonResponse(completo ? 200 : 409, {
        ok: completo,
        error: completo ? undefined : 'Ainda existem itens nao enviados ou cancelados neste lote.'
      });
    }

    if (!/^[1-9]\d*$/.test(String(body.id))) return jsonResponse(400, { error: 'Item invalido.' });
    const item = await rpcLote('cancelar_montagem_posto', { p_id: String(body.id), p_cnpj: cnpj, p_protocolo: protocolo });
    return jsonResponse(200, { ok: true, item });
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Nao foi possivel atualizar o lote.' });
  }
};
