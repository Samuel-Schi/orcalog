import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, proxyResponse } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    const cnpj = String(event.queryStringParameters?.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      return jsonResponse(400, { error: 'CNPJ invalido. Informe 14 digitos.' });
    }

    const res = await fetchWithTimeout(`https://minhareceita.org/${cnpj}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'orcalog-cadastro-cnpj/1.0'
      }
    });

    return proxyResponse(res);
  } catch (err) {
    return handleFunctionError(err);
  }
};
