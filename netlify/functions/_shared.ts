import type { HandlerEvent, HandlerResponse } from '@netlify/functions';

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_JSON_BODY_BYTES = 256000;
const MAX_QUERY_PARAMS = 25;
const MAX_QUERY_KEY_LENGTH = 64;
const MAX_QUERY_VALUE_LENGTH = 2048;

const defaultJsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

export const jsonResponse = (
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {}
): HandlerResponse => ({
  statusCode,
  body: JSON.stringify(payload),
  headers: { ...defaultJsonHeaders, ...headers }
});

export const methodNotAllowed = (allowed: string[]) =>
  jsonResponse(405, { error: `Metodo nao permitido. Use: ${allowed.join(', ')}` }, {
    Allow: allowed.join(', ')
  });

export const sanitizeQueryParams = (input: HandlerEvent['queryStringParameters'] | null | undefined) => {
  const params = new URLSearchParams();
  if (!input) return params;

  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (count >= MAX_QUERY_PARAMS) break;
    const key = String(rawKey || '').trim().slice(0, MAX_QUERY_KEY_LENGTH);
    if (!key) continue;
    const value = String(rawValue ?? '').trim().slice(0, MAX_QUERY_VALUE_LENGTH);
    params.append(key, value);
    count += 1;
  }

  return params;
};

export const parseJsonBody = (event: HandlerEvent, maxBytes = MAX_JSON_BODY_BYTES) => {
  if (!event.body) {
    return { ok: false as const, response: jsonResponse(400, { error: 'Body vazio.' }) };
  }

  if (event.isBase64Encoded) {
    return { ok: false as const, response: jsonResponse(415, { error: 'Body base64 nao suportado.' }) };
  }

  const bodySize = Buffer.byteLength(event.body, 'utf8');
  if (bodySize > maxBytes) {
    return {
      ok: false as const,
      response: jsonResponse(413, { error: 'Payload excede o limite permitido.' })
    };
  }

  try {
    return { ok: true as const, value: JSON.parse(event.body) as unknown };
  } catch {
    return { ok: false as const, response: jsonResponse(400, { error: 'JSON invalido.' }) };
  }
};

export const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const proxyResponse = async (response: Response): Promise<HandlerResponse> => {
  const text = await response.text();
  return {
    statusCode: response.status,
    body: text,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  };
};

export const handleFunctionError = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') {
    return jsonResponse(504, { error: 'Tempo limite excedido na comunicacao com o servico externo.' });
  }

  const message = error instanceof Error ? error.message : 'Erro inesperado';
  return jsonResponse(500, { error: message });
};

export const sanitizeIdentifier = (value: string, fallback: string) => {
  const cleaned = value.trim();
  return /^[a-zA-Z0-9_]+$/.test(cleaned) ? cleaned : fallback;
};

export const trimText = (value: unknown, maxLength = 500) =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLength);
