import type { Handler } from '@netlify/functions';
import { concluirLote, rpcLote } from './_lote-envio';
import { fetchWithTimeout, jsonResponse, methodNotAllowed, parseJsonBody } from './_shared';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as Record<string, unknown>;
  try {
    if (!body || !['CONCLUIR','CANCELAR'].includes(String(body.acao))) return jsonResponse(400,{error:'Ação inválida.'});
    // Reconfirma a identidade no servidor; não aceita CNPJ informado pelo navegador.
    if (!body.usuario || !body.senha_hash) return jsonResponse(401,{error:'Confirme suas credenciais.'});
    const url = new URL('https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/check_user');
    url.searchParams.set('usuario',String(body.usuario).trim().toUpperCase());
    url.searchParams.set('senha_hash',String(body.senha_hash));
    const check = await fetchWithTimeout(url.toString(), {headers:{Accept:'application/json'}});
    if (!check.ok) return jsonResponse(401,{error:'Não foi possível confirmar suas credenciais.'});
    const data = await check.json();
    const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
    const cnpj = String(rows[0]?.cnpj ?? rows[0]?.CNPJ ?? '').replace(/\D/g,'');
    if (rows.length !== 1 || cnpj.length !== 14) return jsonResponse(401,{error:'Credenciais inválidas ou posto sem CNPJ.'});
    if (body.acao==='CONCLUIR') {
      const completo = await concluirLote(cnpj,String(body.protocolo || '').trim());
      return jsonResponse(completo ? 200 : 409,{ok:completo,error:completo ? undefined : 'Ainda existem itens não enviados ou cancelados. Complete os lançamentos.'});
    }
    if (!/^[1-9]\d*$/.test(String(body.id))) return jsonResponse(400,{error:'Item inválido.'});
    const item = await rpcLote('cancelar_lancamento_posto',{p_id:body.id,p_cnpj:cnpj});
    return jsonResponse(200,{ok:true,item});
  } catch (error) {
    return jsonResponse(409,{error:error instanceof Error ? error.message : 'Não foi possível atualizar o lote.'});
  }
};
