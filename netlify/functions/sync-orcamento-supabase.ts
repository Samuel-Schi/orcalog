import type { Handler } from '@netlify/functions';

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

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const tableName = process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados';

    if (!supabaseUrl || !supabaseSecret) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Variaveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorias.' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const payload = JSON.parse(event.body || '{}') as SyncPayload;
    const item = payload.itens?.[0];

    if (!item) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Payload sem item para sincronizar.' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const oracleItemId = toNumber(item.itemId ?? item.id ?? payload.itemId ?? payload.id);
    if (!oracleItemId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'oracle_item_id invalido.' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const record = {
      oracle_item_id: oracleItemId,
      protocolo: payload.protocolo || item.protocolo || '',
      pa_usuario: payload.paUsuario || '',
      cnpj: payload.cnpj || '',
      razao_social: payload.razaoSocial || '',
      unidade: payload.unidade || '',
      email_retorno: payload.emailRetorno || '',
      uuid: item.uuid || '',
      cod_barras: item.codBarras || '',
      ean: item.ean || item.codBarras || '',
      cod_gemco: item.codGemco || '',
      descricao: item.descricao || '',
      fornecedor: item.fornecedor || '',
      linha: item.linha || '',
      serial: item.serial || '',
      defeito_encontrado: item.defeitoEncontrado || '',
      foto_nome: item.fotoNome || '',
      pecas_desc: item.pecasDesc || '',
      val_pecas: toNumber(item.valPecas),
      acess_desc: item.acessDesc || '',
      val_acess: toNumber(item.valAcess),
      val_mao_obra: toNumber(item.valMaoObra),
      val_emb: toNumber(item.valEmb),
      val_hig: toNumber(item.valHig),
      total_orcamento: toNumber(item.totalOrcamento),
      defeito_funcional: item.defeitoFuncional || '',
      garantia: item.garantia || '',
      tipo_orc: item.tipoOrc || '',
      status: toNumber(item.status || 1)
    };

    const normalizedSupabaseUrl = supabaseUrl
      .replace(/\/rest\/v1\/?$/i, '')
      .replace(/\/$/, '');

    const restUrl = `${normalizedSupabaseUrl}/rest/v1/${tableName}?on_conflict=oracle_item_id`;
    const res = await fetch(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseSecret,
        Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify([record])
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
