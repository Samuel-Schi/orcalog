import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const cnpj = String(event.queryStringParameters?.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CNPJ invalido. Informe 14 digitos.' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const res = await fetch(`https://minhareceita.org/${cnpj}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'orcalog-cadastro-cnpj/1.0'
      }
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
