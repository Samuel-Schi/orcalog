import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed } from './_shared';

const pageSize = 1000;

const resolverSupabase = (env: Record<string, string | undefined>) => {
  const base = (env.SUPABASE_ORCAMENTOS_URL || env.SUPABASE_URL || '').trim()
    .replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
  const secret = (env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return { base, secret };
};

const buscarTudo = async (base: string, secret: string, tabela: string, select: string) => {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${base}/rest/v1/${tabela}`);
    url.searchParams.set('select', select);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));
    const response = await fetchWithTimeout(url.toString(), {
      headers: { Accept: 'application/json', apikey: secret, Authorization: `Bearer ${secret}`, 'Accept-Profile': 'public' }
    });
    if (!response.ok) throw new Error(`Falha ao consultar ${tabela} no Supabase.`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error(`Resposta invalida de ${tabela}.`);
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < pageSize) break;
  }
  return rows;
};

export const consultarItemPadrao = async (env: Record<string, string | undefined>) => {
  const { base, secret } = resolverSupabase(env);
  if (!base || !secret) return jsonResponse(500, { error: 'Variaveis do Supabase nao configuradas.' });

  try {
    const [padroesRaw, linhasRaw, aliasesRaw] = await Promise.all([
      buscarTudo(base, secret, 'item_padrao', 'codigo,nome_canonico,tipo,ativo'),
      buscarTudo(base, secret, 'item_padrao_linha', 'codigo,linha'),
      buscarTudo(base, secret, 'item_alias', 'alias_norm,alias,codigo')
    ]);
    const padroes = padroesRaw
      .filter((r) => r.ativo !== false)
      .map((r) => ({ codigo: String(r.codigo), nomeCanonico: String(r.nome_canonico ?? ''), tipo: String(r.tipo ?? 'PECA') }));
    const linhas = linhasRaw.map((r) => ({ codigo: String(r.codigo), linha: String(r.linha ?? '') }));
    const aliases = aliasesRaw.map((r) => ({ codigo: String(r.codigo), alias: String(r.alias ?? ''), aliasNorm: String(r.alias_norm ?? '') }));
    return jsonResponse(200, { padroes, linhas, aliases });
  } catch {
    return jsonResponse(502, { error: 'Falha ao consultar o catalogo padrao no Supabase.' });
  }
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);
  try {
    return await consultarItemPadrao(process.env);
  } catch (error) {
    return handleFunctionError(error);
  }
};
