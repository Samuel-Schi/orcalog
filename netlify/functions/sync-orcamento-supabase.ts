import type { Handler } from '@netlify/functions';
import {
  fetchWithTimeout,
  handleFunctionError,
  jsonResponse,
  methodNotAllowed,
  parseJsonBody,
  sanitizeIdentifier,
  trimText
} from './_shared';

type SyncPayload = {
  id?: number;
  itemId?: number;
  protocolo?: string;
  paUsuario?: string;
  cnpj?: string;
  razaoSocial?: string;
  unidade?: string;
  emailRetorno?: string;
  itens?: Array<{
    id?: number;
    itemId?: number;
    protocolo?: string;
    uuid?: string;
    codBarras?: string;
    ean?: string;
    codGemco?: string;
    descricao?: string;
    fornecedor?: string;
    linha?: string;
    serial?: string;
    defeitoEncontrado?: string;
    fotoNome?: string;
    pecasDesc?: string;
    valPecas?: number;
    acessDesc?: string;
    valAcess?: number;
    valMaoObra?: number;
    valEmb?: number;
    valHig?: number;
    totalOrcamento?: number;
    defeitoFuncional?: string;
    garantia?: string;
    tipoOrc?: string;
    status?: number;
  }>;
};

const toNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildRecord = (
  payload: SyncPayload,
  item: NonNullable<SyncPayload['itens']>[number]
) => {
  const oracleItemId = toNumber(item.itemId ?? item.id ?? payload.itemId ?? payload.id);
  if (!oracleItemId) return null;

  return {
    oracle_item_id: oracleItemId,
    protocolo: trimText(payload.protocolo || item.protocolo || '', 80),
    pa_usuario: trimText(payload.paUsuario || '', 80),
    cnpj: trimText(payload.cnpj || '', 20),
    razao_social: trimText(payload.razaoSocial || '', 180),
    unidade: trimText(payload.unidade || '', 120),
    email_retorno: trimText(payload.emailRetorno || '', 180),
    uuid: trimText(item.uuid || '', 120),
    cod_barras: trimText(item.codBarras || '', 80),
    ean: trimText(item.ean || item.codBarras || '', 80),
    cod_gemco: trimText(item.codGemco || '', 80),
    descricao: trimText(item.descricao || '', 250),
    fornecedor: trimText(item.fornecedor || '', 180),
    linha: trimText(item.linha || '', 120),
    serial: trimText(item.serial || '', 120),
    defeito_encontrado: trimText(item.defeitoEncontrado || '', 250),
    foto_nome: trimText(item.fotoNome || '', 180),
    pecas_desc: trimText(item.pecasDesc || '', 250),
    val_pecas: toNumber(item.valPecas),
    acess_desc: trimText(item.acessDesc || '', 250),
    val_acess: toNumber(item.valAcess),
    val_mao_obra: toNumber(item.valMaoObra),
    val_emb: toNumber(item.valEmb),
    val_hig: toNumber(item.valHig),
    total_orcamento: toNumber(item.totalOrcamento),
    defeito_funcional: trimText(item.defeitoFuncional || '', 80),
    garantia: trimText(item.garantia || '', 80),
    tipo_orc: trimText(item.tipoOrc || '', 80),
    status: toNumber(item.status ?? 0)
  };
};

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const supabaseUrl = String(
      process.env.SUPABASE_ORCAMENTOS_URL ||
      process.env.SUPABASE_URL ||
      ''
    ).trim();
    const supabaseSecret = String(
      process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ''
    ).trim();
    const tableName = sanitizeIdentifier(
      process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados',
      'orcamentos_finalizados'
    );

    if (!supabaseUrl || !supabaseSecret) {
      return jsonResponse(500, { error: 'Variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.' });
    }

    const parsedBody = parseJsonBody(event);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const payload = parsedBody.value as SyncPayload;
    const records = (payload.itens || [])
      .map((item) => buildRecord(payload, item))
      .filter((record): record is NonNullable<typeof record> => Boolean(record));

    if (records.length === 0) {
      return jsonResponse(400, { error: 'Payload sem item para sincronizar.' });
    }

    const normalizedSupabaseUrl = supabaseUrl
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/$/, '');

    const restUrl = `${normalizedSupabaseUrl}/rest/v1/${tableName}?on_conflict=${encodeURIComponent('oracle_item_id')}`;
    const res = await fetchWithTimeout(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseSecret,
        Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(records)
    });

    const text = await res.text();
    if (!res.ok) {
      return jsonResponse(res.status, {
        error: 'Falha ao sincronizar orcamento no Supabase.',
        detail: text || null,
        table: tableName,
        records: records.length
      });
    }

    return {
      statusCode: res.status,
      body: text,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    };
  } catch (err) {
    return handleFunctionError(err);
  }
};
