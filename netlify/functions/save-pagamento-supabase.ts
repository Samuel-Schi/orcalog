import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, sanitizeIdentifier, trimText } from './_shared';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
    const parsed = parseJsonBody(event);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as Record<string, unknown>;
    const protocolo = trimText(body.protocolo, 120);
    const cnpj = String(body.cnpj || '').replace(/\D/g, '');
    const tipo = String(body.tipoNota || '').trim().toUpperCase();
    const numero = trimText(body.notaFiscalNumero, 80);
    const nome = trimText(body.notaFiscalNome, 180);
    const arquivoId = trimText(body.notaFiscalArquivoId, 100);
    const valor = Number(body.valorPagamento);
    if (!protocolo || cnpj.length !== 14 || !['PRODUTO','SERVICO'].includes(tipo) || !numero || !nome || !/^[A-Za-z0-9_-]+$/.test(arquivoId) || !Number.isFinite(valor) || valor <= 0) {
      return jsonResponse(400, { error: 'Informe tipo, número, valor positivo e PDF válido da nota.' });
    }
    const base = String(process.env.SUPABASE_ORCAMENTOS_URL || process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/i,'').replace(/\/$/,'');
    const key = process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    const table = sanitizeIdentifier(process.env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados','orcamentos_finalizados');
    if (!base || !key || table !== 'orcamentos_finalizados') return jsonResponse(500,{error:'Pagamento por lote não configurado.'});
    const headers={apikey:key,Authorization:`Bearer ${key}`,Accept:'application/json'};
    const consulta=new URL(`${base}/rest/v1/${table}`);
    consulta.searchParams.set('select','pagamento_status'); consulta.searchParams.set('protocolo',`eq.${protocolo}`); consulta.searchParams.set('cnpj',`eq.${cnpj}`); consulta.searchParams.set('status','eq.10'); consulta.searchParams.set('limit','500');
    const atual=await fetchWithTimeout(consulta.toString(),{headers});
    const rows=await atual.json().catch(()=>null) as Array<{pagamento_status?:string}>|null;
    if (!atual.ok || !rows?.length) return jsonResponse(atual.ok?404:atual.status,{error:'Protocolo aprovado não encontrado para este posto.'});
    const statusAtual=String(rows[0].pagamento_status || 'AGUARDANDO_NOTA');
    if (!rows.every(row=>String(row.pagamento_status || 'AGUARDANDO_NOTA')===statusAtual)) return jsonResponse(409,{error:'O lote possui etapas financeiras diferentes. Atualize a tela e confira antes de anexar.'});
    const statusAnterior=statusAtual==='NOTA_ENVIADA'?'EM_VALIDACAO':statusAtual;
    if (!['AGUARDANDO_NOTA','EM_VALIDACAO'].includes(statusAnterior)) return jsonResponse(409,{error:'Este lote não aceita novas notas nesta etapa.'});
    const resposta=await fetchWithTimeout(`${base}/rest/v1/rpc/atualizar_pagamento_lote`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({
      p_protocolo:protocolo,p_status_anterior:statusAnterior,p_status:'EM_VALIDACAO',p_referencia:trimText(body.pagamentoReferencia,120)||protocolo,
      p_nota:{tipo,numero,nome,arquivo_id:arquivoId,valor:Math.round(valor*100)/100,url:`https://drive.google.com/file/d/${arquivoId}/view`}
    })});
    const resultado=await resposta.json().catch(()=>({}));
    if (!resposta.ok) {
      const conflito=resultado?.code==='40001'||resultado?.code==='22003';
      return jsonResponse(conflito?409:resposta.status,{error:resultado?.message || 'Não foi possível salvar a nota. Execute a migração de pagamento atualizada no Supabase.'});
    }
    return jsonResponse(200,resultado);
  } catch (error) { return handleFunctionError(error); }
};
