import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio.js';
import { jsonResponse, methodNotAllowed, parseJsonBody, trimText } from './_shared.js';

/** Identificador para peca sem serial (supabase/serial_gerado.sql). Mesmo item do mesmo lote = mesmo codigo. */
export const montarPedidoSerial = (body: Record<string, unknown>) => {
  const cnpj = String(body?.cnpj || '').replace(/\D/g, '');
  const protocolo = trimText(body?.protocolo, 60);
  const itens = Array.isArray(body?.itens) ? body.itens as Record<string, unknown>[] : [];
  if (cnpj.length !== 14 || !protocolo || !itens.length || itens.length > 200) return null;
  const lista = itens.map((item) => ({
    chave: String(item?.chave || ''),
    nota_fiscal: trimText(item?.notaFiscal, 60) || null,
    cod_gemco: trimText(item?.codGemco, 40) || null
  }));
  if (lista.some((item) => !/^[A-Za-z0-9-]{8,64}$/.test(item.chave))) return null;
  return { p_cnpj: cnpj, p_protocolo: protocolo, p_pa_usuario: trimText(body?.paUsuario, 120) || null, p_itens: lista };
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  const pedido = montarPedidoSerial(parsed.value as Record<string, unknown>);
  if (!pedido) return jsonResponse(400, { error: 'Pedido de identificador invalido.' });
  try {
    const resultado = await rpcLote('gerar_seriais_peca', pedido, 20000);
    if (!Array.isArray(resultado) || resultado.length !== pedido.p_itens.length) throw new Error('O banco nao devolveu todos os identificadores.');
    return jsonResponse(200, { itens: resultado });
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Nao foi possivel gerar os identificadores.' });
  }
};
