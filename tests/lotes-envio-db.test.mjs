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

test('item reprovado durante a contraproposta sai do acordo e os demais sao aprovados', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    const {cnpj,a,b,c}=await prepararLoteMisto(db,'M3');
    await db.query("UPDATE orcamentos_finalizados SET status=7,status_text='EM_NEGOCIACAO' WHERE id=$1",[a]);
    // Lote de 600 (100+200+300): AT propos 400, posto contrapropos 450; AT reprova A (100) e aprova B e C.
    await db.query("INSERT INTO orcamento_negociacoes(protocolo,cnpj,negotiation_scope,item_ids,valor_original,valor_proposto_at,valor_contraproposta_posto,status) VALUES('M3',$1,'LOTE',$2::jsonb,600,400,450,'CONTRAPROPOSTA_POSTO')",[cnpj,JSON.stringify([a,b,c])]);
    await db.query("UPDATE orcamentos_finalizados SET status=10,status_text='REPROVADO' WHERE id=$1",[a]);
    const r=(await db.query("SELECT aprovar_negociacao_lote('M3',$1,'ANALISTA') AS r",[[b,c]])).rows[0].r;
    assert.deepEqual(r.items.map(i=>String(i.id)).sort(),[b,c].sort());
    const t=await totais(db,'M3');
    // 450 x (500/600) = 375 para B e C.
    assert.equal(Math.round((t[b].total+t[c].total)*100),37500);
    assert.equal(t[a].total,100);
    const n=(await db.query("SELECT status,observacao_at FROM orcamento_negociacoes WHERE protocolo='M3'")).rows[0];
    assert.equal(n.status,'ACEITA_POSTO');
    assert.match(n.observacao_at,/saíram do acordo: R\$ 375/);
    // Rodar de novo nao muda valor nem duplica a observacao.
    await db.query("SELECT aprovar_negociacao_lote('M3',$1,'ANALISTA')",[[b,c]]);
    const t2=await totais(db,'M3');
    assert.equal(Math.round((t2[b].total+t2[c].total)*100),37500);
    assert.equal((await db.query("SELECT observacao_at FROM orcamento_negociacoes WHERE protocolo='M3'")).rows[0].observacao_at.match(/saíram do acordo/g).length,1);
  } finally {await db.close();}
});

test('retificacao: devolucao/sem reoperacao mudam a classificacao; reaprovar volta o item com valor novo', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const rms=new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/',import.meta.url);
    await db.exec(await readFile(new URL('supabase.sql',rms),'utf8'));
    await db.exec(await readFile(new URL('migracao-pagamento-lote.sql',rms),'utf8'));
    const ret=await readFile(new URL('migracao-retificacao.sql',rms),'utf8');
    await db.exec(ret); await db.exec(ret); // reexecucao segura
    const inserir=async(status_text)=>(await db.query("INSERT INTO orcamentos_finalizados(protocolo,cnpj,status,status_text,tipo_orc,total_orcamento,val_pecas,val_mao_obra) VALUES('R1','1',10,$1,'SALDO A',100,60,40) RETURNING id",[status_text])).rows[0].id;
    const [dev,semOp,rep]=[await inserir('APROVADO'),await inserir('APROVADO'),await inserir('REPROVADO')];
    const item=async(id)=>(await db.query('SELECT * FROM orcamentos_finalizados WHERE id=$1',[id])).rows[0];
    const retificar=(ids,motivo,valores=null)=>db.query("SELECT retificar_orcamento_at('R1',$1::bigint[],$2,'ANALISTA',$3::jsonb)",[ids,motivo,valores&&JSON.stringify(valores)]);

    await retificar([dev],'DEVOLUCAO');
    await retificar([semOp],'DESCONSIDERAR_REPARO');
    assert.deepEqual([(await item(dev)).status_text,(await item(dev)).tipo_orc,Number((await item(dev)).total_orcamento)],['RETIFICADO','DEVOLUCAO',0]);
    assert.equal((await item(semOp)).tipo_orc,'SEM REOPERACAO');
    await assert.rejects(db.query("UPDATE orcamentos_finalizados SET total_orcamento=5 WHERE id=$1",[dev]),/bloqueada/);
    await assert.rejects(retificar([dev],'DESCONSIDERAR_REPARO'),/já retificado/);

    // Reaprovar: so item reprovado/retificado, com valor.
    await assert.rejects(retificar([rep],'REAPROVAR',{}),/valor aprovado/);
    await retificar([rep,dev],'REAPROVAR',{[rep]:80,[dev]:50});
    const r=await item(rep), d=await item(dev);
    assert.deepEqual([r.status_text,Number(r.total_orcamento),Number(r.valor_produtos_aprovado),Number(r.valor_servicos_aprovado),r.retificacao.motivo],['APROVADO',80,48,32,'REAPROVADO']);
    assert.deepEqual([d.status_text,d.tipo_orc,Number(d.total_orcamento),Number(d.val_pecas)],['APROVADO','SALDO A',50,60]);
    assert.equal(d.retificacao.anterior.motivo,'DEVOLUCAO');
    // Item reaprovado volta ao fluxo normal: o pagamento consegue gravar nele.
    await db.query("UPDATE orcamentos_finalizados SET pagamento_status='EM_VALIDACAO' WHERE id=$1",[rep]);
    await assert.rejects(retificar([semOp].concat([]),'REAPROVAR',{[semOp]:-1}),/valor aprovado/);
  } finally { await db.close(); }
});

test('baixa de pagamento por planilha: nota + kirk + data + OC', {skip:!process.env.PGLITE_TEST_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db=new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const rms=new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/',import.meta.url);
    await db.exec(await readFile(new URL('supabase.sql',rms),'utf8'));
    await db.exec(await readFile(new URL('migracao-pagamento-lote.sql',rms),'utf8'));
    const baixa=await readFile(new URL('migracao-baixa-pagamento.sql',rms),'utf8');
    await db.exec(baixa); await db.exec(baixa);
    const nota=(tipo,numero,valor)=>({tipo,numero,nome:`${numero}.pdf`,arquivo_id:`a${numero}`,valor});
    // P1: peca (NF 001) + servico (NF 2); P2 tem uma nota com o mesmo numero 2 (outro posto).
    await db.query("INSERT INTO orcamentos_finalizados(protocolo,cnpj,status,status_text,total_orcamento,val_pecas,val_mao_obra,pagamento_status,pagamento_referencia,notas_fiscais) VALUES('P1','1',10,'APROVADO',100,60,40,'PAGAMENTO_SOLICITADO','Peça: K-1 · Serviço: K-2',$1::jsonb),('P1','1',10,'APROVADO',100,60,40,'PAGAMENTO_SOLICITADO','Peça: K-1 · Serviço: K-2',$1::jsonb),('P2','2',10,'APROVADO',50,50,0,'EM_VALIDACAO','K-9',$2::jsonb)",
      [JSON.stringify([nota('PRODUTO','001',120),nota('SERVICO','2',80)]),JSON.stringify([nota('PRODUTO','2',50)])]);
    const baixar=async(linhas,aplicar)=>(await db.query("SELECT baixar_pagamentos_por_nota($1::jsonb,'ANALISTA',$2) AS r",[JSON.stringify(linhas),aplicar])).rows[0].r;
    const linhas=[{nota:'1',data:'2026-11-20',oc:'OC-10',kirk:''},{nota:'2',data:'2026-11-21',oc:'OC-11',kirk:''},{nota:'2',data:'2026-11-21',oc:'OC-11',kirk:'K-2'},{nota:'999',data:'2026-11-21'},{nota:'1',data:'xx'}];
    const previa=await baixar(linhas,false);
    assert.deepEqual(previa.linhas.map(l=>l.resultado),['PARCIAL','AMBIGUA','PAGO','NAO_ENCONTRADA','INVALIDA']);
    assert.equal((await db.query("SELECT count(*)::int n FROM orcamentos_finalizados WHERE pagamento_status='PAGO'")).rows[0].n,0,'previa nao grava');
    const r=await baixar(linhas,true);
    assert.deepEqual(r.linhas.map(l=>l.resultado),['PARCIAL','AMBIGUA','PAGO','NAO_ENCONTRADA','INVALIDA']);
    const p1=(await db.query("SELECT pagamento_status,pagamento_validacao_status,pagamento_data::text,pagamento_oc,notas_fiscais FROM orcamentos_finalizados WHERE protocolo='P1'")).rows;
    assert.ok(p1.every(x=>x.pagamento_status==='PAGO' && x.pagamento_validacao_status==='VALIDADO' && x.pagamento_data==='2026-11-21' && x.pagamento_oc==='OC-10 · OC-11'));
    assert.deepEqual(p1[0].notas_fiscais.map(n=>[n.numero,n.pago_em,n.oc]),[['001','2026-11-20','OC-10'],['2','2026-11-21','OC-11']]);
    // Lote ainda em validacao nao recebe baixa.
    assert.equal((await baixar([{nota:'2',data:'2026-11-21',kirk:'K-9'}],true)).linhas[0].resultado,'SEM_SOLICITACAO');
  } finally { await db.close(); }
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
