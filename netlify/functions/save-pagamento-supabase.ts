import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, sanitizeIdentifier, trimText } from './_shared';
import { consolidarPagamentosPorProtocolo, type NegociacaoPagamentoRaw, type PagamentoItemRaw } from '../../src/lib/pagamentosConsolidado';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as Record<string, unknown>;
    const itemId = Number(body.oracleItemId);
    let protocolo = trimText(body.protocolo, 120);
    const cnpj = String(body.cnpj || '').replace(/\D/g, '');
    const driveLink = trimText(body.notaFiscalDriveLink, 1000);
    const fileName = trimText(body.notaFiscalNome, 180);
    const valorPagamento = Number(body.valorPagamento);
    if (body.kirkNumero != null && (typeof body.kirkNumero !== 'string' || body.kirkNumero.trim().length > 80)) {
      return jsonResponse(400, { error: 'O número Kirk deve ter no máximo 80 caracteres.' });
    }
    const numeroNota = trimText(body.notaFiscalNumero, 80);
    if ((!protocolo && (!Number.isFinite(itemId) || itemId <= 0)) || !cnpj || !driveLink || !fileName || !numeroNota || !Number.isFinite(valorPagamento) || valorPagamento < 0) {
      return jsonResponse(400, { error: 'Protocolo, CNPJ e nota fiscal são obrigatórios.' });
    }

    const supabaseUrl = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').trim();
    const supabaseSecret = String(process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const tableName = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados', 'orcamentos_finalizados');
    if (!supabaseUrl || !supabaseSecret) return jsonResponse(500, { error: 'Variáveis do Supabase não configuradas.' });

    const baseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    if (!protocolo) {
      const protocoloUrl = new URL(`${baseUrl}/rest/v1/${tableName}`);
      protocoloUrl.searchParams.set('select', 'protocolo');
      protocoloUrl.searchParams.set('oracle_item_id', `eq.${itemId}`);
      protocoloUrl.searchParams.set('cnpj', `eq.${cnpj}`);
      protocoloUrl.searchParams.set('limit', '1');
      const protocoloResponse = await fetchWithTimeout(protocoloUrl.toString(), {
        headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
      });
      const protocoloText = await protocoloResponse.text();
      if (!protocoloResponse.ok) return jsonResponse(protocoloResponse.status, { error: 'Não foi possível localizar o protocolo do orçamento.', detail: protocoloText || null });
      const rows = JSON.parse(protocoloText) as Array<{ protocolo?: string | null }>;
      protocolo = trimText(rows[0]?.protocolo, 120);
    }
    if (!protocolo) return jsonResponse(404, { error: 'Protocolo finalizado não encontrado.' });

    const consultaUrl = new URL(`${baseUrl}/rest/v1/${tableName}`);
    consultaUrl.searchParams.set('select', 'id,oracle_item_id,protocolo,cod_gemco,descricao,serial,total_orcamento,status,status_text,pagamento_status,pagamento_referencia,valor_pagamento,nota_fiscal_numero,nota_fiscal_nome,nota_fiscal_drive_link,nota_fiscal_enviada_em,pagamento_solicitado_em,pagamento_validacao_status');
    consultaUrl.searchParams.set('protocolo', `eq.${protocolo}`);
    consultaUrl.searchParams.set('cnpj', `eq.${cnpj}`);
    consultaUrl.searchParams.set('status', 'eq.10');
    consultaUrl.searchParams.set('limit', '500');
    const consulta = await fetchWithTimeout(consultaUrl.toString(), {
      headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
    });
    const consultaTexto = await consulta.text();
    if (!consulta.ok) return jsonResponse(consulta.status, { error: 'Não foi possível validar o valor do orçamento.', detail: consultaTexto || null });
    const registros = JSON.parse(consultaTexto) as PagamentoItemRaw[];
    if (!registros.length) return jsonResponse(404, { error: 'Protocolo finalizado não encontrado.' });

    const negociacoesTable = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_NEGOCIACOES_TABLE || 'orcamento_negociacoes', 'orcamento_negociacoes');
    const negociacoesUrl = new URL(`${baseUrl}/rest/v1/${negociacoesTable}`);
    negociacoesUrl.searchParams.set('select', 'protocolo,status,negotiation_scope,item_ids,valor_proposto_at');
    negociacoesUrl.searchParams.set('cnpj', `eq.${cnpj}`);
    negociacoesUrl.searchParams.set('protocolo', `eq.${protocolo}`);
    const negociacoesResponse = await fetchWithTimeout(negociacoesUrl.toString(), {
      headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
    });
    const negociacoesText = await negociacoesResponse.text();
    if (!negociacoesResponse.ok) return jsonResponse(negociacoesResponse.status, { error: 'Não foi possível validar as negociações do protocolo.', detail: negociacoesText || null });

    const [consolidado] = consolidarPagamentosPorProtocolo(registros, JSON.parse(negociacoesText) as NegociacaoPagamentoRaw[]);
    const valorOrcamento = consolidado?.total_protocolo;
    if (!consolidado || !Number.isFinite(valorOrcamento)) return jsonResponse(404, { error: 'Protocolo finalizado não encontrado.' });
    if (valorPagamento - valorOrcamento > 0.01) {
      return jsonResponse(422, { error: 'O valor informado ultrapassa o valor total aprovado do protocolo.', valorOrcamento, valorInformado: valorPagamento });
    }

    const patchUrl = new URL(`${baseUrl}/rest/v1/${tableName}`);
    patchUrl.searchParams.set('protocolo', `eq.${protocolo}`);
    patchUrl.searchParams.set('cnpj', `eq.${cnpj}`);
    patchUrl.searchParams.set('status', 'eq.10');
    const response = await fetchWithTimeout(patchUrl.toString(), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        pagamento_status: 'NOTA_ENVIADA',
        pagamento_referencia: trimText(body.pagamentoReferencia, 120) || protocolo,
        nota_fiscal_nome: fileName,
        ...(body.kirkNumero !== undefined ? { kirk_numero: trimText(body.kirkNumero, 80) || null } : {}),
        nota_fiscal_numero: numeroNota,
        nota_fiscal_drive_link: driveLink,
        nota_fiscal_enviada_em: new Date().toISOString(),
        pagamento_solicitado_em: new Date().toISOString(),
        valor_pagamento: valorPagamento,
        pagamento_validacao_status: 'VALIDADO'
      })
    });
    const text = await response.text();
    if (!response.ok) {
      const missingPaymentSchema = response.status === 400 && /pagamento_status|nota_fiscal|pagamento_|kirk_numero/i.test(text);
      return jsonResponse(response.status, {
        error: missingPaymentSchema
          ? 'A tabela de pagamentos ainda nao foi configurada no Supabase. Execute supabase/pagamentos_setup.sql no SQL Editor.'
          : 'Falha ao salvar a nota fiscal no Supabase.',
        detail: text || null
      });
    }
    return { statusCode: 200, body: text, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } };
  } catch (error) {
    return handleFunctionError(error);
  }
};
