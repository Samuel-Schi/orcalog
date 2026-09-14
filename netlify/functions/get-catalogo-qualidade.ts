import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed } from './_shared';

export const consultarCatalogo = async (env: Record<string, string | undefined>) => {
  const base = (env.SUPABASE_ORCAMENTOS_URL || env.SUPABASE_URL || '').trim()
    .replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
  const secret = (env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!base || !secret) return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });

  const rows: unknown[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${base}/rest/v1/catalogo_qualidade`);
    url.searchParams.set('select', 'id,linha,tipo,item,ativo');
    url.searchParams.set('ativo', 'eq.true');
    url.searchParams.set('order', 'id.asc');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json', apikey: secret, Authorization: `Bearer ${secret}`, 'Accept-Profile': 'public' }
    });
    if (!response.ok) return jsonResponse(502, { error: 'Falha ao consultar o catalogo no Supabase.' });
    const page: unknown = await response.json();
    if (!Array.isArray(page)) return jsonResponse(502, { error: 'Resposta invalida do catalogo.' });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return jsonResponse(200, rows);
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);
  try {
    return await consultarCatalogo(process.env);
  } catch (error) {
    return handleFunctionError(error);
  }
};
