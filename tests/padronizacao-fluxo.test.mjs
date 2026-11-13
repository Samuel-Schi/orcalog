import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const compilar = async (entrada, nome) => {
  const { outputFiles } = await build({ entryPoints: [entrada], bundle: true, platform: 'node', format: 'cjs', write: false });
  const caminho = path.resolve(nome);
  const modulo = new Module(caminho);
  modulo.filename = caminho;
  modulo.paths = Module._nodeModulePaths(path.dirname(caminho));
  modulo._compile(outputFiles[0].text, caminho);
  return modulo.exports;
};
const envio = await compilar('src/lib/envioOrcamento.ts', 'src/lib/padronizacao-envio.test.cjs');
const importacao = await compilar('src/lib/importacaoOrcamento.ts', 'src/lib/padronizacao-importacao.test.cjs');
const padrao = await compilar('src/lib/pecaPadrao.ts', 'src/lib/padronizacao-peca.test.cjs');
const funcao = await compilar('netlify/functions/item-padrao-decisao.ts', 'netlify/functions/item-padrao-decisao.test.cjs');

const CAB = ['Serial', 'Nota fiscal', 'Gemco ou Código de barras', 'Defeito encontrado', 'Defeito funcional (SIM/NAO)', 'Garantia (SIM/NAO)', 'Tipo Orc.', 'Peças (nome: valor; nome: valor)', 'Acessórios (nome: valor; nome: valor)', 'Mão de obra (R$)', 'Embalagem (R$)', 'Higienização (R$)'];
const linha = (serial, pecas) => [serial, 'NF', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', pecas, '', '', '', ''];
const catalogo = () => padrao.indexarCatalogo(
  [{ codigo: 'PEC1', nomeCanonico: 'PLACA PRINCIPAL', tipo: 'PECA' }, { codigo: 'PEC2', nomeCanonico: 'DISPLAY', tipo: 'PECA' }],
  [{ codigo: 'PEC1', linha: 'ED1 - ELETRO 1' }],
  [{ codigo: 'PEC2', alias: 'TELA' }]
);

test('padronizacao automatica: parecida troca sozinha, desconhecida vai com o original, nada trava', () => {
  const { itens } = importacao.interpretarPlanilhaOrcamento([CAB, linha('S1', 'Tela: 100; Placa principall: 50'), linha('S2', 'Tampa traseira: 10'), linha('S3', 'placa principall: 20')]);
  envio.aplicarPadraoPecas(itens, catalogo());
  assert.equal(itens[0].pecas[0].nome, 'DISPLAY', 'apelido troca sem aviso');
  assert.equal(itens[0].pecas[1].nome, 'PLACA PRINCIPAL', 'parecida troca sozinha');
  assert.equal(itens[1].pecas[0].nome, 'Tampa traseira', 'desconhecida fica com o nome original');
  assert.deepEqual(itens.map(importacao.itemBloqueado), [false, false, false]);
  assert.deepEqual(importacao.inconsistenciasDoLote(itens), []);

  // O envio leva so nome e valor (o nome digitado fica fora do payload).
  const valores = importacao.montarValoresOrcamento(itens[0]);
  assert.equal(valores.pecasDesc, 'pe;display;placa principal');
  assert.deepEqual(JSON.parse(valores.pecasDetalhes), [{ nome: 'DISPLAY', valor: 100 }, { nome: 'PLACA PRINCIPAL', valor: 50 }]);

  const trocadas = envio.gruposPadronizados(itens);
  assert.deepEqual(trocadas.map((g) => [g.original, g.canonico, g.desfeita, g.linhasPlanilha]), [['Placa principall', 'PLACA PRINCIPAL', false, [2, 4]]]);
  assert.deepEqual(envio.gruposSemPadrao(itens).map((g) => [g.original, g.linhasPlanilha]), [['Tampa traseira', [3]]]);
  assert.ok(itens[0].pendencias.some((p) => !p.bloqueia && /padronizada automaticamente/.test(p.mensagem)));

  // Desfazer vale para todos os produtos com a mesma descricao: volta ao digitado e vira "sem padrao".
  let lote = envio.alternarPadronizacao(itens, trocadas[0].chave, true);
  assert.equal(lote[0].pecas[1].nome, 'Placa principall');
  assert.equal(lote[2].pecas[0].nome, 'placa principall');
  assert.equal(lote[0].pecas[0].nome, 'DISPLAY', 'nao mexe em outra peca do item');
  assert.equal(envio.gruposPadronizados(lote)[0].desfeita, true);
  assert.deepEqual(envio.gruposSemPadrao(lote).map((g) => g.original).sort(), ['Placa principall', 'Tampa traseira']);
  assert.deepEqual(lote.map(importacao.itemBloqueado), [false, false, false]);

  // Refazer devolve o padrao.
  lote = envio.alternarPadronizacao(lote, trocadas[0].chave, false);
  assert.equal(lote[2].pecas[0].nome, 'PLACA PRINCIPAL');
  assert.deepEqual(envio.gruposSemPadrao(lote).map((g) => g.original), ['Tampa traseira']);
  assert.equal(lote[0].pendencias.filter((p) => p.campo === 'padrao').length, 1, 'desfazer/refazer nao acumula aviso');
  // A trava final do envio aceita o lote.
  envio.validarLoteParaEnvio(lote);
});

test('padronizar de novo nao acumula pendencias', () => {
  const { itens } = importacao.interpretarPlanilhaOrcamento([CAB, linha('S1', 'Tampa: 10')]);
  envio.aplicarPadraoPecas(itens, catalogo());
  envio.aplicarPadraoPecas(itens, catalogo());
  assert.equal(itens[0].pendencias.filter((p) => p.campo === 'padrao').length, 1);
});

test('funcao valida a decisao antes de chamar o banco', () => {
  assert.equal(funcao.montarDecisao({ tipo: 'ALIAS', nomeOriginal: 'Tela' }), null);
  assert.equal(funcao.montarDecisao({ tipo: 'APAGAR', nomeOriginal: 'Tela', codigo: 'PEC1' }), null);
  assert.deepEqual(funcao.montarDecisao({ tipo: 'alias', nomeOriginal: ' Tela ', codigo: 'PEC2', cnpj: '12.345.678/0001-99', protocolo: 'P1', paUsuario: 'posto' }), {
    tipo: 'ALIAS', nome_original: 'Tela', codigo: 'PEC2', nome_sugerido: undefined, linha: undefined, pa_usuario: 'posto', cnpj: '12345678000199', protocolo: 'P1'
  });
  assert.equal(funcao.montarDecisao({ tipo: 'SOLICITACAO', nomeOriginal: 'Tampa', nomeSugerido: 'TAMPA TRASEIRA' }).nome_sugerido, 'TAMPA TRASEIRA');
});

// Banco em memoria: PGLITE_TEST_MODULE aponta para o @electric-sql/pglite instalado fora do projeto.
test('SQL: apelido, pedido unico por nome, aprovacao cria o padrao e o apelido', { skip: !process.env.PGLITE_TEST_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    await db.exec(`CREATE TABLE item_padrao (codigo text PRIMARY KEY, nome_canonico text NOT NULL, nome_norm text NOT NULL, tipo text NOT NULL DEFAULT 'PECA', ativo boolean NOT NULL DEFAULT true);
      CREATE TABLE item_padrao_linha (codigo text NOT NULL REFERENCES item_padrao(codigo), linha text NOT NULL, PRIMARY KEY (codigo, linha));
      CREATE TABLE item_alias (alias_norm text PRIMARY KEY, alias text NOT NULL, codigo text NOT NULL REFERENCES item_padrao(codigo));
      INSERT INTO item_padrao VALUES ('PEC0009', 'PLACA PRINCIPAL', 'PLACA PRINCIPAL', 'PECA', true);`);
    const sql = await readFile(new URL('../supabase/item_padrao_padronizacao_fluxo.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // reexecucao segura
    const decidir = async (dados) => (await db.query('SELECT registrar_decisao_padrao($1::jsonb) AS r', [JSON.stringify(dados)])).rows[0].r;

    assert.equal((await db.query("SELECT normalizar_nome_peca('  placa   eletrônica ') AS n")).rows[0].n, 'PLACA ELETRONICA');
    assert.deepEqual(await decidir({ tipo: 'ALIAS', nome_original: 'Placa mãe', codigo: 'PEC0009', pa_usuario: 'posto1' }), { ok: true, tipo: 'ALIAS', codigo: 'PEC0009', ja_existia: false });
    assert.equal((await decidir({ tipo: 'ALIAS', nome_original: 'PLACA MAE', codigo: 'PEC0009' })).ja_existia, true);
    const alias = (await db.query("SELECT origem, registrado_por FROM item_alias WHERE alias_norm = 'PLACA MAE'")).rows[0];
    assert.deepEqual(alias, { origem: 'POSTO', registrado_por: 'posto1' });
    await assert.rejects(decidir({ tipo: 'ALIAS', nome_original: 'X', codigo: 'NAOEXISTE' }), /nao existe/);

    const p1 = await decidir({ tipo: 'SOLICITACAO', nome_original: 'Tampa traseira', linha: 'ED1 - ELETRO 1', cnpj: '1' });
    const p2 = await decidir({ tipo: 'SOLICITACAO', nome_original: 'TAMPA  TRASEIRA', cnpj: '2' });
    assert.equal(p1.id, p2.id);
    assert.equal((await db.query('SELECT qtd_pedidos FROM item_padrao_solicitacao WHERE id = $1', [p1.id])).rows[0].qtd_pedidos, 2);

    const codigo = (await db.query("SELECT aprovar_solicitacao_padrao($1, 'aprovador', 'Tampa traseira') AS c", [p1.id])).rows[0].c;
    assert.equal(codigo, 'PEC0010');
    assert.equal((await db.query("SELECT codigo FROM item_alias WHERE alias_norm = 'TAMPA TRASEIRA'")).rows.length, 0, 'nome igual ao canonico nao vira apelido');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM item_padrao_linha WHERE codigo = 'PEC0010'")).rows[0].n, 1);
    assert.equal((await db.query('SELECT status FROM item_padrao_solicitacao WHERE id = $1', [p1.id])).rows[0].status, 'APROVADA');
    await assert.rejects(db.query("SELECT aprovar_solicitacao_padrao($1, 'aprovador')", [p1.id]), /nao esta pendente/);

    // Depois de aprovado, um novo pedido do mesmo nome e um pedido novo (o anterior nao esta mais pendente).
    const p3 = await decidir({ tipo: 'SOLICITACAO', nome_original: 'Tampinha' });
    const ligado = (await db.query("SELECT aprovar_solicitacao_padrao($1, 'aprovador', NULL, 'PEC0010') AS c", [p3.id])).rows[0].c;
    assert.equal(ligado, 'PEC0010');
    assert.equal((await db.query("SELECT codigo, origem FROM item_alias WHERE alias_norm = 'TAMPINHA'")).rows[0].origem, 'APROVACAO');
    const p4 = await decidir({ tipo: 'SOLICITACAO', nome_original: 'Gabinete' });
    await db.query("SELECT recusar_solicitacao_padrao($1, 'aprovador', 'Use TAMPA TRASEIRA')", [p4.id]);
    assert.equal((await db.query('SELECT status FROM item_padrao_solicitacao WHERE id = $1', [p4.id])).rows[0].status, 'RECUSADA');
  } finally {
    await db.close();
  }
});
