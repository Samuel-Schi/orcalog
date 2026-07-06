import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  methodNotAllowed,
  parseJsonBody,
  proxyResponse,
  sanitizeQueryParams
} from './_shared';

const CHECK_URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/check_user';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
      return methodNotAllowed(['GET', 'POST']);
    }

    let response: Response;
    if (event.httpMethod === 'GET') {
      const params = sanitizeQueryParams(event.queryStringParameters);
      response = await fetchWithTimeout(`${CHECK_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
    } else {
      const parsedBody = parseJsonBody(event);
      if (!parsedBody.ok) {
        return parsedBody.response;
      }

      const payload = parsedBody.value;
      const res = await fetchWithTimeout(CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });

      response = res;
      if (res.status === 405 && payload && typeof payload === 'object') {
        const params = new URLSearchParams();
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            params.append(String(key).slice(0, 64), String(value).slice(0, 2048));
          }
        });

        response = await fetchWithTimeout(`${CHECK_URL}?${params.toString()}`, {
          method: 'GET',
          headers: { Accept: 'application/json' }
        });
      }
    }

    return proxyResponse(response);
  } catch (err) {
    return handleFunctionError(err);
  }
};
