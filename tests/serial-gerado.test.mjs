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
const envio = await compilar('src/lib/envioOrcamento.ts', 'src/lib/serial-envio.test.cjs');
const importacao = await compilar('src/lib/importacaoOrcamento.ts', 'src/lib/serial-importacao.test.cjs');
const funcao = await compilar('netlify/functions/gerar-serial-peca.ts', 'netlify/functions/gerar-serial-peca.test.cjs');

const CAB = ['Serial', 'Nota fiscal', 'Gemco ou Código de barras', 'Defeito encontrado', 'Defeito funcional (SIM/NAO)', 'Garantia (SIM/NAO)', 'Tipo Orc.', 'Peças (nome: valor; nome: valor)', 'Acessórios (nome: valor; nome: valor)', 'Mão de obra (R$)', 'Embalagem (R$)', 'Higienização (R$)'];
const linha = (serial, nf) => [serial, nf, '10', 'Não liga', 'SIM', 'NAO', 'NOVO', '', '', 50, '', ''];
const BASE = { protocolo: 'P1-1', paUsuario: 'posto', cnpj: '12345678000199' };

// Banco falso com a mesma regra do SQL: mesma chave = mesmo codigo; chave nova = proximo numero.
const bancoFalso = () => {
  const porChave = new Map();
  let seq = 0;
  const chamadas = [];
  const postar = async (body) => {
    chamadas.push(body);
    return { itens: body.itens.map((i) => {
      if (!porChave.has(i.chave)) porChave.set(i.chave, `SSAT${String(++seq).padStart(8, '0')}`);
      return { chave: i.chave, codigo: porChave.get(i.chave) };
    }) };
  };
  return { postar, chamadas };
};

test('peca sem serial recebe identificador unico, que vira o serial e nao muda ao repetir', async () => {
  const { itens } = importacao.interpretarPlanilhaOrcamento([CAB, linha('', 'NF1'), linha('ABC123', 'NF2'), linha('', 'NF3')]);
  assert.deepEqual(itens.map(importacao.serialExibido), ['Gerado no envio', 'ABC1-23', 'Gerado no envio']);
  assert.ok(itens[0].pendencias.some((p) => p.mensagem === importacao.AVISO_SEM_SERIAL && !p.bloqueia));
  envio.validarLoteParaEnvio(itens);

  const banco = bancoFalso();
  await envio.gerarIdentificadoresPeca(itens, BASE, banco.postar);
  assert.deepEqual(itens.map((i) => i.serial), ['SSAT-0000-0001', 'ABC1-23', 'SSAT-0000-0002']);
  assert.deepEqual(banco.chamadas[0].itens.map((i) => i.notaFiscal), ['NF1', 'NF3']);
  assert.equal(banco.chamadas[0].cnpj, BASE.cnpj);
  assert.ok(itens[0].pendencias.some((p) => /Identificador gerado: SSAT-0000-0001/.test(p.mensagem)));
  assert.ok(!itens[0].pendencias.some((p) => p.mensagem === importacao.AVISO_SEM_SERIAL));

  // "Tentar novamente": quem ja tem serial nao pede de novo.
  await envio.gerarIdentificadoresPeca(itens, BASE, banco.postar);
  assert.equal(banco.chamadas.length, 1);
  // Mesmo se o serial se perdesse, a chave do item traz o mesmo codigo de volta.
  itens[0].serial = '';
  await envio.gerarIdentificadoresPeca(itens, BASE, banco.postar);
  assert.equal(itens[0].serial, 'SSAT-0000-0001');
  // Redigitar o identificador mantem o mesmo formato (o serial nao muda no ciclo de vida).
  assert.equal(importacao.interpretarPlanilhaOrcamento([CAB, linha('ssat00000001', 'NF1')]).itens[0].serial, 'SSAT-0000-0001');
});

test('nao segue sem o identificador de todas as pecas', async () => {
  const { itens } = importacao.interpretarPlanilhaOrcamento([CAB, linha('', 'NF1'), linha('', 'NF2')]);
  await assert.rejects(envio.gerarIdentificadoresPeca(itens, BASE, async (body) => ({ itens: [{ chave: body.itens[0].chave, codigo: 'SSAT00000009' }] })), /todas as peças/);
  await assert.rejects(envio.gerarIdentificadoresPeca(itens, BASE, async (body) => ({ itens: body.itens.map((i) => ({ chave: i.chave, codigo: 'XYZ' })) })), /todas as peças/);
});

test('funcao valida o pedido antes de chamar o banco', () => {
  assert.equal(funcao.montarPedidoSerial({ cnpj: '123', protocolo: 'P1', itens: [{ chave: 'abcdefgh-1' }] }), null);
  assert.equal(funcao.montarPedidoSerial({ cnpj: '12345678000199', protocolo: 'P1', itens: [{ chave: 'x' }] }), null);
  assert.equal(funcao.montarPedidoSerial({ cnpj: '12345678000199', protocolo: 'P1', itens: [] }), null);
  assert.deepEqual(funcao.montarPedidoSerial({ cnpj: '12.345.678/0001-99', protocolo: 'P1', paUsuario: 'posto', itens: [{ chave: 'abcdefgh-1', notaFiscal: 'NF1', codGemco: '10' }] }), {
    p_cnpj: '12345678000199', p_protocolo: 'P1', p_pa_usuario: 'posto', p_itens: [{ chave: 'abcdefgh-1', nota_fiscal: 'NF1', cod_gemco: '10' }]
  });
});

test('SQL: numeros unicos, mesmo item devolve o mesmo codigo, historico gravado', { skip: !process.env.PGLITE_TEST_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
    const sql = await readFile(new URL('../supabase/serial_gerado.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql); // reexecucao segura
    const gerar = async (protocolo, chaves, cnpj = '12345678000199') => (await db.query('SELECT gerar_seriais_peca($1, $2, $3, $4::jsonb) AS r',
      [cnpj, protocolo, 'posto', JSON.stringify(chaves.map((chave) => ({ chave, nota_fiscal: `NF-${chave}`, cod_gemco: '10' })))])).rows[0].r;

    const primeiro = await gerar('P1', ['item-aaaa-1', 'item-bbbb-2']);
    assert.deepEqual(primeiro, [{ chave: 'item-aaaa-1', codigo: 'SSAT00000001' }, { chave: 'item-bbbb-2', codigo: 'SSAT00000002' }]);
    // Reenvio do mesmo lote: mesmos codigos, nenhum numero novo.
    assert.deepEqual(await gerar('P1', ['item-bbbb-2', 'item-aaaa-1']), [{ chave: 'item-bbbb-2', codigo: 'SSAT00000002' }, { chave: 'item-aaaa-1', codigo: 'SSAT00000001' }]);
    // Outro lote (ou outro posto) com a mesma chave recebe outro numero.
    assert.equal((await gerar('P2', ['item-aaaa-1']))[0].codigo, 'SSAT00000003');
    assert.equal((await gerar('P1', ['item-aaaa-1'], '99999999000199'))[0].codigo, 'SSAT00000004');
    const codigos = (await db.query('SELECT codigo FROM serial_gerado')).rows.map((r) => r.codigo);
    assert.equal(new Set(codigos).size, codigos.length);
    assert.deepEqual((await db.query("SELECT nota_fiscal, cod_gemco, pa_usuario FROM serial_gerado WHERE codigo = 'SSAT00000001'")).rows[0],
      { nota_fiscal: 'NF-item-aaaa-1', cod_gemco: '10', pa_usuario: 'posto' });
    await assert.rejects(gerar('P1', ['curta']), /Chave de item invalida/);
    await assert.rejects(gerar('P1', ['item-cccc-3'], '123'), /Posto ou protocolo invalido/);
  } finally {
    await db.close();
  }
});
