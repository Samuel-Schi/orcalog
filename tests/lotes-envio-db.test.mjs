// Banco PostgreSQL em memória opcional: definir PGLITE_TEST_MODULE para o módulo instalado fora do projeto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('envio completo, cancelamento, relançamento e aprovação negociada atômica', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const rms=new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/',import.meta.url);
    await db.exec(await readFile(new URL('supabase.sql',rms),'utf8'));
    await db.exec(await readFile(new URL('migracao-retificacao.sql',rms),'utf8'));
    await db.exec(await readFile(new URL('migracao-pagamento-lote.sql',rms),'utf8'));
    const sql=await readFile(new URL('../supabase/lotes_envio_seguro.sql',import.meta.url),'utf8');
    await db.exec(sql);
    await db.exec(sql); // reexecução segura
    const cnpj='12345678000199';
    const receber=async(id,valor)=>db.query('SELECT receber_item_posto($1::jsonb)',[JSON.stringify({oracle_item_id:String(id),protocolo:'L1',cnpj,total_orcamento:valor,val_pecas:valor,val_acess:0,val_mao_obra:0,val_emb:0,val_hig:0})]);
    const concluir=()=>db.query("SELECT concluir_envio_lote('L1',$1,ARRAY['101','102']) AS completo",[cnpj]);
    await receber(101,100);
    assert.deepEqual((await db.query("SELECT status,envio_finalizado FROM orcamentos_finalizados WHERE oracle_item_id='101'")).rows[0], {status:8,envio_finalizado:false});
    assert.equal((await concluir()).rows[0].completo,false);
    await assert.rejects(db.exec("UPDATE orcamentos_finalizados SET status=3 WHERE protocolo='L1'"),/concluiu/);
    await receber(102,200);
    const ids=(await db.query("SELECT id FROM orcamentos_finalizados WHERE protocolo='L1' ORDER BY id")).rows.map(r=>r.id);
    await assert.rejects(db.query('SELECT cancelar_lancamento_posto($1,$2)',[ids[0],'99999999000199']),/não encontrado/);
    await db.query('SELECT cancelar_lancamento_posto($1,$2)',[ids[0],cnpj]);
    assert.equal((await concluir()).rows[0].completo,false);
    await receber(101,100);
    assert.equal((await concluir()).rows[0].completo,true);
    assert.ok((await db.query("SELECT status,status_text,envio_finalizado FROM orcamentos_finalizados WHERE protocolo='L1'")).rows.every(r=>r.status===0 && r.status_text==='PENDENTE' && r.envio_finalizado));
    await assert.rejects(receber(101,100),/bloqueados/);
    assert.equal((await db.query("SELECT concluir_envio_lote('L1',$1,ARRAY['101']) AS completo",[cnpj])).rows[0].completo,false);
    assert.ok((await db.query("SELECT envio_finalizado FROM orcamentos_finalizados WHERE protocolo='L1'")).rows.every(r=>r.envio_finalizado));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM orcamentos_finalizados WHERE protocolo='L1'")).rows[0].n,2);
    await db.exec("UPDATE orcamentos_finalizados SET status=3 WHERE protocolo='L1'");
    await assert.rejects(receber(101,100),/análise/);
    await assert.rejects(db.query('SELECT cancelar_lancamento_posto($1,$2)',[ids[0],cnpj]),/análise/);
    await db.query("INSERT INTO orcamento_negociacoes(protocolo,cnpj,negotiation_scope,valor_original,valor_proposto_at,status) VALUES('L1',$1,'LOTE',300,250.01,'ACEITA_POSTO')",[cnpj]);
    await assert.rejects(db.query("SELECT aprovar_negociacao_lote('L1',$1,'ANALISTA')",[[String(ids[0])]]),/todos os itens/);
    await db.query("SELECT aprovar_negociacao_lote('L1',$1,'ANALISTA')",[ids.map(String)]);
    const values=(await db.query("SELECT total_orcamento,valor_pagamento,valor_original_aprovacao,negociacao_aplicada FROM orcamentos_finalizados ORDER BY id")).rows;
    assert.equal(values.reduce((sum,r)=>sum+Math.round(Number(r.total_orcamento)*100),0),25001);
    assert.ok(values.every(r=>r.negociacao_aplicada && Number(r.total_orcamento)===Number(r.valor_pagamento)));
    assert.equal(values.reduce((sum,r)=>sum+Number(r.valor_original_aprovacao),0),300);
    await db.query("SELECT aprovar_negociacao_lote('L1',$1,'ANALISTA')",[ids.map(String)]);
    assert.equal(Number((await db.query('SELECT sum(total_orcamento) AS total FROM orcamentos_finalizados')).rows[0].total),250.01);
  } finally {await db.close();}
});

// Lote de 3 produtos: 1 aprovado direto pela AT, outro em negociação; o posto manda contraproposta e a AT aprova.
const prepararLoteMisto = async (db, protocolo) => {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const rms=new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/',import.meta.url);
  await db.exec(await readFile(new URL('supabase.sql',rms),'utf8'));
  await db.exec(await readFile(new URL('migracao-retificacao.sql',rms),'utf8'));
  await db.exec(await readFile(new URL('migracao-pagamento-lote.sql',rms),'utf8'));
  await db.exec(await readFile(new URL('../supabase/lotes_envio_seguro.sql',import.meta.url),'utf8'));
  const cnpj='12345678000199';
  for (const [oracle,valor] of [[301,100],[302,200],[303,300]]) {
    await db.query('SELECT receber_item_posto($1::jsonb)',[JSON.stringify({oracle_item_id:String(oracle),protocolo,cnpj,total_orcamento:valor,val_pecas:valor,val_acess:0,val_mao_obra:0,val_emb:0,val_hig:0})]);
  }
  await db.query('SELECT concluir_envio_lote($1,$2,ARRAY[$3,$4,$5])',[protocolo,cnpj,'301','302','303']);
  const [a,b,c]=(await db.query('SELECT id FROM orcamentos_finalizados WHERE protocolo=$1 ORDER BY oracle_item_id',[protocolo])).rows.map(r=>String(r.id));
  // A: aprovado direto (PATCH normal); B e C: em negociação.
  await db.query("UPDATE orcamentos_finalizados SET status=10,status_text='APROVADO' WHERE id=$1",[a]);
  await db.query("UPDATE orcamentos_finalizados SET status=7,status_text='EM_NEGOCIACAO' WHERE id IN ($1,$2)",[b,c]);
  return {cnpj,a,b,c};
};
const totais = async (db, protocolo) => Object.fromEntries((await db.query('SELECT id::text,total_orcamento,status,negociacao_aplicada FROM orcamentos_finalizados WHERE protocolo=$1',[protocolo])).rows.map(r=>[r.id,{total:Number(r.total_orcamento),status:r.status,aplicada:r.negociacao_aplicada}]));

test('aprova contraproposta de negociacao por item junto com outros itens pendentes', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    const {cnpj,a,b,c}=await prepararLoteMisto(db,'M1');
    await db.query("UPDATE orcamentos_finalizados SET status=0,status_text='PENDENTE' WHERE id=$1",[c]);
    await db.query("INSERT INTO orcamento_negociacoes(protocolo,cnpj,negotiation_scope,item_ids,valor_original,valor_proposto_at,valor_contraproposta_posto,status) VALUES('M1',$1,'ITEM',$2::jsonb,200,150,180,'CONTRAPROPOSTA_POSTO')",[cnpj,JSON.stringify([b])]);
    // "Aprovar itens pendentes" manda B (negociado) e C (sem negociação) juntos.
    const r=(await db.query("SELECT aprovar_negociacao_lote('M1',$1,'ANALISTA') AS r",[[b,c]])).rows[0].r;
    assert.deepEqual(r.items.map(i=>String(i.id)),[b], 'a função consolida só o item negociado; C segue para a aprovação normal');
    const t=await totais(db,'M1');
    assert.deepEqual(t[b],{total:180,status:10,aplicada:true});
    assert.equal(t[a].total,100);
    assert.equal(t[c].total,300);
    const n=(await db.query("SELECT status,valor_proposto_at FROM orcamento_negociacoes WHERE protocolo='M1'")).rows[0];
    assert.deepEqual([n.status,Number(n.valor_proposto_at)],['ACEITA_POSTO',180]);
  } finally {await db.close();}
});

test('aprova contraproposta de negociacao do lote sem incluir o item que ja estava aprovado', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    const {cnpj,a,b,c}=await prepararLoteMisto(db,'M2');
    // Negociação do lote criada depois da aprovação de A (registros antigos não guardam item_ids no escopo LOTE).
    await db.query("INSERT INTO orcamento_negociacoes(protocolo,cnpj,negotiation_scope,valor_original,valor_proposto_at,valor_contraproposta_posto,status) VALUES('M2',$1,'LOTE',500,400,450,'CONTRAPROPOSTA_POSTO')",[cnpj]);
    const r=(await db.query("SELECT aprovar_negociacao_lote('M2',$1,'ANALISTA') AS r",[[b,c]])).rows[0].r;
    assert.deepEqual(r.items.map(i=>String(i.id)).sort(),[b,c].sort());
    const t=await totais(db,'M2');
    assert.deepEqual(t[a],{total:100,status:10,aplicada:false}, 'o item já aprovado não entra no rateio');
    assert.equal(Math.round((t[b].total+t[c].total)*100),45000);
    assert.ok(t[b].aplicada && t[c].aplicada && t[b].status===10 && t[c].status===10);
    // Reaprovar não muda os valores.
    await db.query("SELECT aprovar_negociacao_lote('M2',$1,'ANALISTA')",[[b,c]]);
    const t2=await totais(db,'M2');
    assert.equal(Math.round((t2[b].total+t2[c].total)*100),45000);
    // Aprovar só parte da negociação continua bloqueado.
    await db.query("UPDATE orcamento_negociacoes SET status='ACEITA_POSTO' WHERE protocolo='M2'");
    await db.query("UPDATE orcamentos_finalizados SET status=7,status_text='EM_NEGOCIACAO',negociacao_aplicada=false WHERE id IN ($1,$2)",[b,c]);
    await assert.rejects(db.query("SELECT aprovar_negociacao_lote('M2',$1,'ANALISTA')",[[b]]),/todos os itens/);
  } finally {await db.close();}
});

test('nota fiscal parcial respeita o saldo separado de produto e servico', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const rms=new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/',import.meta.url);
    await db.exec(await readFile(new URL('supabase.sql',rms),'utf8'));
    await db.exec(await readFile(new URL('migracao-pagamento-lote.sql',rms),'utf8'));
    await db.exec("INSERT INTO orcamentos_finalizados(protocolo,cnpj,status,status_text,total_orcamento,val_pecas,val_mao_obra) VALUES('NF-1','12345678000199',10,'APROVADO',100,60,40)");
    const limites=(await db.query("SELECT valor_produtos_aprovado,valor_servicos_aprovado FROM orcamentos_finalizados WHERE protocolo='NF-1'")).rows[0];
    assert.equal(Number(limites.valor_produtos_aprovado),60);
    assert.equal(Number(limites.valor_servicos_aprovado),40);
    const produto={tipo:'PRODUTO',numero:'1',nome:'produto.pdf',arquivo_id:'produto1',valor:60};
    await db.query("SELECT atualizar_pagamento_lote('NF-1','AGUARDANDO_NOTA','EM_VALIDACAO',$1::text,$2::jsonb)",['NF-1',JSON.stringify(produto)]);
    await assert.rejects(db.query("SELECT atualizar_pagamento_lote('NF-1','EM_VALIDACAO','EM_VALIDACAO',NULL,$1::jsonb)",[JSON.stringify({...produto,arquivo_id:'produto2',numero:'2',valor:.01})]),/excede o saldo/);
    await db.query("SELECT atualizar_pagamento_lote('NF-1','EM_VALIDACAO','EM_VALIDACAO',NULL,$1::jsonb)",[JSON.stringify({tipo:'SERVICO',numero:'3',nome:'servico.pdf',arquivo_id:'servico1',valor:40})]);
  } finally { await db.close(); }
});
