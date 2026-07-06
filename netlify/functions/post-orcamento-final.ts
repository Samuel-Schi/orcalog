import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, methodNotAllowed, proxyResponse } from './_shared';

const URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/post_orcamento_final';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const res = await fetchWithTimeout(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: event.body || '{}'
    });

    return proxyResponse(res);
  } catch (err) {
    return handleFunctionError(err);
  }
};
