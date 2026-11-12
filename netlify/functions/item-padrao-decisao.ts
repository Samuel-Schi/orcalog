import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio';
import { jsonResponse, methodNotAllowed, parseJsonBody, trimText } from './_shared';

/*
 * Decisao de padronizacao feita pelo posto na conferencia (supabase/item_padrao_padronizacao_fluxo.sql):
 *  ALIAS       -> descricao original ligada a um padrao existente (vira apelido do catalogo).
 *  SOLICITACAO -> pedido de padrao novo, pendente de aprovacao.
 */
export const montarDecisao = (body: Record<string, unknown>) => {
  const tipo = String(body?.tipo || '').toUpperCase();
  const nomeOriginal = trimText(body?.nomeOriginal, 200);
  const codigo = trimText(body?.codigo, 40);
  if (!['ALIAS', 'SOLICITACAO'].includes(tipo) || !nomeOriginal) return null;
  if (tipo === 'ALIAS' && !/^[A-Z0-9_-]{1,40}$/i.test(codigo)) return null;
  return {
    tipo,
    nome_original: nomeOriginal,
    codigo: tipo === 'ALIAS' ? codigo : undefined,
    nome_sugerido: tipo === 'SOLICITACAO' ? trimText(body?.nomeSugerido, 200) || undefined : undefined,
    linha: trimText(body?.linha, 120) || undefined,
    pa_usuario: trimText(body?.paUsuario, 120) || undefined,
    cnpj: String(body?.cnpj || '').replace(/\D/g, '').slice(0, 14) || undefined,
    protocolo: trimText(body?.protocolo, 60) || undefined
  };
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  const decisao = montarDecisao(parsed.value as Record<string, unknown>);
  if (!decisao) return jsonResponse(400, { error: 'Decisao de padronizacao invalida.' });
  try {
    const resultado = await rpcLote('registrar_decisao_padrao', { p_dados: decisao });
    return jsonResponse(200, resultado ?? { ok: true });
  } catch (error) {
    return jsonResponse(409, { error: error instanceof Error ? error.message : 'Nao foi possivel registrar a padronizacao.' });
  }
};
