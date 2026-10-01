import type { Handler } from '@netlify/functions';
import { concluirLote, rpcLote } from './_lote-envio';
import {
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
    linkDrive?: string;
    link_drive?: string;
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
  const linkDrive = trimText(item.link_drive || item.linkDrive || item.fotoNome || '', 1000);

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
    foto_nome: trimText(item.fotoNome || linkDrive, 180),
    link_drive: linkDrive,
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

    /* Cada envio é validado e salvo sob trava no servidor. Não faz upsert
       sobre um orçamento que já entrou em análise. */
    if (tableName !== 'orcamentos_finalizados') return jsonResponse(500, { error: 'Tabela incompatível com a RPC de envio seguro.' });
    const recebidos = [];
    for (const record of records) recebidos.push(await rpcLote('receber_item_posto', { p_item: record }));
    const lotes = new Map(records.map(record => [record.protocolo, record.cnpj]));
    for (const [protocolo, cnpj] of lotes) await concluirLote(cnpj, protocolo);
    return jsonResponse(200, recebidos);
  } catch (err) {
    return handleFunctionError(err);
  }
};
