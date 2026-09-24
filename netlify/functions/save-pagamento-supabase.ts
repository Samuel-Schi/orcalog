import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, sanitizeIdentifier, trimText } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as Record<string, unknown>;
    const itemId = Number(body.oracleItemId);
    const driveLink = trimText(body.notaFiscalDriveLink, 1000);
    const fileName = trimText(body.notaFiscalNome, 180);
    const valorPagamento = Number(body.valorPagamento);
    const numeroNota = trimText(body.notaFiscalNumero, 80);
    if (!Number.isFinite(itemId) || itemId <= 0 || !driveLink || !fileName || !numeroNota || !Number.isFinite(valorPagamento) || valorPagamento < 0) {
      return jsonResponse(400, { error: 'Item e nota fiscal são obrigatórios.' });
    }

    const supabaseUrl = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').trim();
    const supabaseSecret = String(process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const tableName = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados', 'orcamentos_finalizados');
    if (!supabaseUrl || !supabaseSecret) return jsonResponse(500, { error: 'Variáveis do Supabase não configuradas.' });

    const baseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
    const consulta = await fetchWithTimeout(`${baseUrl}/rest/v1/${tableName}?select=total_orcamento,status&oracle_item_id=eq.${encodeURIComponent(String(itemId))}&limit=1`, {
      headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
    });
    const consultaTexto = await consulta.text();
    if (!consulta.ok) return jsonResponse(consulta.status, { error: 'Não foi possível validar o valor do orçamento.', detail: consultaTexto || null });
    const registros = JSON.parse(consultaTexto) as Array<{ total_orcamento?: number | string | null; status?: number | string | null }>;
    const valorOrcamento = Number(registros[0]?.total_orcamento);
    if (!registros.length || !Number.isFinite(valorOrcamento)) return jsonResponse(404, { error: 'Orçamento finalizado não encontrado.' });
    if (Number(registros[0]?.status) !== 10) return jsonResponse(409, { error: 'Somente orçamentos finalizados podem seguir para pagamento.' });
    if (Math.abs(valorPagamento - valorOrcamento) > 0.01) {
      return jsonResponse(422, { error: 'O valor informado não confere com o valor final do orçamento.', valorOrcamento, valorInformado: valorPagamento });
    }
    const response = await fetchWithTimeout(`${baseUrl}/rest/v1/${tableName}?oracle_item_id=eq.${encodeURIComponent(String(itemId))}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        pagamento_status: 'NOTA_ENVIADA',
        pagamento_referencia: trimText(body.pagamentoReferencia, 120),
        nota_fiscal_nome: fileName,
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
      const missingPaymentSchema = response.status === 400 && /pagamento_status|nota_fiscal|pagamento_/i.test(text);
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
