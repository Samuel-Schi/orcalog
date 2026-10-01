import type { Handler } from '@netlify/functions';
import { rpcLote } from './_lote-envio';
import { handleFunctionError, jsonResponse, methodNotAllowed } from './_shared';

export const listarPosto: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);
  const cnpj = String(event.queryStringParameters?.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return jsonResponse(400, { error: 'Informe o CNPJ do posto.' });
  try {
    const itens: unknown[] = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      const page = await rpcLote('listar_orcamentos_posto', { p_cnpj: cnpj, p_offset: offset });
      if (!Array.isArray(page)) throw new Error('Resposta invalida ao consultar os orcamentos no Supabase.');
      itens.push(...page);
      if (page.length < 500) return jsonResponse(200, itens);
    }
    return jsonResponse(422, { error: 'Quantidade de itens excede o limite de consulta.' });
  } catch (error) { return handleFunctionError(error); }
};
