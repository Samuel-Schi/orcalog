import type { Handler } from '@netlify/functions';

const CHECK_URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/check_user';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const payload = event.body ? JSON.parse(event.body) : null;
    if (!payload) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Body vazio.' }) };
    }

    const res = await fetch(CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Fallback: se o ORDS não aceita POST (405), tenta GET com querystring
    let response = res;
    if (res.status === 405) {
      const params = new URLSearchParams();
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(key, String(value));
        }
      });
      response = await fetch(`${CHECK_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
    }

    const text = await response.text();
    return {
      statusCode: response.status,
      body: text,
      headers: { 'Content-Type': response.headers.get('content-type') || 'application/json' }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro inesperado';
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
