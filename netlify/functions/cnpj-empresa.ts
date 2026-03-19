import type { Handler } from '@netlify/functions';

const TOKEN_URL = 'https://h-apigateway.conectagov.np.estaleiro.serpro.gov.br/oauth2/jwt-token';
const API_BASE = 'https://h-apigateway.conectagov.np.estaleiro.serpro.gov.br/api-cnpj-empresa/v2/empresa';

let cachedToken: { token: string; exp: number } | null = null;

const getAccessToken = async () => {
  const now = Date.now();
  if (cachedToken && cachedToken.exp > now + 30_000) return cachedToken.token;

  const clientId = process.env.SERPRO_CLIENT_ID;
  const clientSecret = process.env.SERPRO_CLIENT_SECRET;
  const scope = process.env.SERPRO_SCOPE || 'api-cnpj-v1';

  if (!clientId || !clientSecret) {
    throw new Error('Credenciais OAuth não configuradas.');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope,
    client_id: clientId,
    client_secret: clientSecret
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Falha ao obter token.');
  }

  const data = await res.json();
  const token = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 300;

  cachedToken = { token, exp: now + expiresIn * 1000 };
  return token;
};

export const handler: Handler = async (event) => {
  try {
    const cnpj = event.path.split('/').pop() || '';
    const cnpjDigits = cnpj.replace(/\D/g, '');

    if (cnpjDigits.length !== 14) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CNPJ inválido' })
      };
    }

    const token = await getAccessToken();

    const res = await fetch(`${API_BASE}/${cnpjDigits}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const text = await res.text();
    return {
      statusCode: res.status,
      body: text,
      headers: { 'Content-Type': 'application/json' }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro inesperado';
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg })
    };
  }
};
