import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, methodNotAllowed, proxyResponse } from './_shared';

const INFO_URL =
  'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/bet_user_inf';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    const qs = event.rawQuery ? `?${event.rawQuery}` : '';
    const res = await fetchWithTimeout(`${INFO_URL}${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    return proxyResponse(res);
  } catch (err) {
    return handleFunctionError(err);
  }
};
