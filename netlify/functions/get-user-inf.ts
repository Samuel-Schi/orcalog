import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  methodNotAllowed,
  proxyResponse,
  sanitizeQueryParams
} from './_shared';

const URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/get_user_inf';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    const params = sanitizeQueryParams(event.queryStringParameters);
    const res = await fetchWithTimeout(`${URL}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    return proxyResponse(res);
  } catch (err) {
    return handleFunctionError(err);
  }
};
