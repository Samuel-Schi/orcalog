import type { Handler } from '@netlify/functions';

const URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/post_orcamento_final';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: event.body || '{}'
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      body: text,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro inesperado';
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
};
