import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

test('rascunhos ficam fora da AT; finalizar transfere o lote completo atomicamente', {skip: !process.env.PGLITE_TEST_MODULE}, async () => {
  const {PGlite} = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const rms = new URL('../../rms-utils-react/magalog-system/src/pages/OrcamentoAT/docs/', import.meta.url);
    for (const file of ['supabase.sql','migracao-retificacao.sql','migracao-pagamento-lote.sql']) await db.exec(await readFile(new URL(file,rms),'utf8'));
    await db.exec(await readFile(new URL('../supabase/lotes_envio_seguro.sql',import.meta.url),'utf8'));
    const migration = await readFile(new URL('../supabase/orcamento_posto_supabase.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const cnpj='12345678000199';
    const items=['A','B'].map(uuid=>({uuid,serial:uuid,protocolo:'STAGE-1',cnpj,pa_usuario:'POSTO',total_orcamento:0}));
    const register=()=>db.query('SELECT registrar_lote_posto($1::jsonb)',[JSON.stringify(items)]);
    await register(); await register();
    assert.equal((await db.query('SELECT count(*)::int n FROM orcamento_lancamento_rascunhos')).rows[0].n,2);
    const listar=async()=> (await db.query('SELECT listar_orcamentos_posto($1) itens',[cnpj])).rows[0].itens;
    const drafts=await listar();
    assert.ok(drafts.every(r=>r.status===8 && !r.envio_recebido && !r.envio_finalizado));
    assert.equal((await db.query('SELECT count(*)::int n FROM orcamentos_finalizados')).rows[0].n,0);
    const save=async(item)=>db.query('SELECT salvar_item_montagem($1::jsonb,true)',[JSON.stringify({...item,total_orcamento:53,val_pecas:50,val_acess:3,val_mao_obra:0,val_emb:0,val_hig:0})]);
    const finish=()=>db.query("SELECT finalizar_montagem_posto('STAGE-1',$1) ok",[cnpj]);
    await save(drafts[0]);
    await db.query('SELECT salvar_item_montagem($1::jsonb,false)',[JSON.stringify({...drafts[0],rascunho:{valPecas:999}})]);
    assert.equal(Number((await listar())[0].total_orcamento),53);
    // Finalizar nao confirma valores, mas fica bloqueado ate que todos os
    // produtos tenham o seu orcamento efetivamente salvo na montagem.
    await assert.rejects(finish(),/orcamento salvo/);
    await save(drafts[1]);
    assert.equal((await finish()).rows[0].ok,true);
    assert.equal((await finish()).rows[0].ok,true);
    const enviados=await listar();
    assert.equal(enviados.length,2);
    assert.ok(enviados.every(r=>r.status===0 && r.envio_finalizado));
    assert.ok(enviados.some(r=>Number(r.total_orcamento)===53));
    await assert.rejects(save(drafts[0]),/enviado/);
    await assert.rejects(db.query("SELECT finalizar_montagem_posto('STAGE-1','99999999999999')"),/nao encontrado/);
  } finally {await db.close();}
});
