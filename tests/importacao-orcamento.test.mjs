import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';

const { outputFiles } = await build({ entryPoints: ['src/lib/importacaoOrcamento.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const compiled = new Module(path.resolve('src/lib/importacao-orcamento.test.cjs'));
compiled._compile(outputFiles[0].text, compiled.id);
const { consultarProdutosOrcamento, inconsistenciasDoLote, interpretarPlanilhaOrcamento, itemBloqueado, lerPlanilhaOrcamento, lerValorMonetario, montarItemCadastro, montarValoresOrcamento, quebrarItensComValor, seriaisDuplicados } = compiled.exports;

const CABECALHO = ['Serial', 'Nota fiscal', 'Gemco ou Código de barras', 'Defeito encontrado', 'Defeito funcional (SIM/NAO)', 'Garantia (SIM/NAO)', 'Tipo Orc.', 'Peças (nome: valor; nome: valor)', 'Acessórios (nome: valor; nome: valor)', 'Mão de obra (R$)', 'Embalagem (R$)', 'Higienização (R$)'];

const planilha = (linhas) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(linhas), 'Orçamento');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
};

test('uma linha por produto: quebra pecas e acessorios e soma os valores', async () => {
  const { itens, errosLinha } = await lerPlanilhaOrcamento(planilha([
    CABECALHO,
    ['abc12345', 'NF-1', 123456, 'Nao liga', 'sim', 'Não', 'novo', 'Display: 300; Flex: R$ 1.020,00', 'Controle = 35', '80,50', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', ''],
    ['xyz999', 'NF-2', '7891234567890', 'Não liga', 'NAO', 'NAO', 'Saldo A', '', '', '', 10, 15]
  ]));
  assert.deepEqual(errosLinha, []);
  assert.equal(itens.length, 2);
  const [a, b] = itens;
  assert.equal(a.serial, 'ABC1-2345');
  assert.equal(a.linha, 2);
  assert.deepEqual([a.codigo, a.defeitoFuncional, a.garantia, a.tipoOrc], ['123456', 'SIM', 'NAO', 'NOVO']);
  assert.deepEqual(a.pecas, [{ nome: 'Display', valor: 300 }, { nome: 'Flex', valor: 1020 }]);
  assert.deepEqual(a.acessorios, [{ nome: 'Controle', valor: 35 }]);
  assert.equal(a.valMaoObra, 80.5);
  assert.equal(a.total, 1435.5);
  assert.deepEqual(a.pendencias, []);
  assert.equal(b.linha, 4);
  assert.equal(b.tipoOrc, 'SALDO A');
  assert.equal(b.total, 25);
});

test('serial repetido na planilha tira todas as ocorrencias e trava o lote', () => {
  const { itens, errosLinha, seriaisRepetidos } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', 'NF', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Placa: 10', '', '', '', ''],
    ['s1', 'NF', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Tela: 10', '', '', '', ''],
    ['', 'NF', '10', 'x', 'SIM', 'NAO', 'NOVO', '', '', '', '', ''],
    ['S2', 'NF', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Tela: 10', '', '', '', ''],
    ['', 'NF', '10', 'x', 'SIM', 'NAO', 'NOVO', '', '', '', '', '']
  ]);
  // Serial em branco nao e erro nem duplicidade: a peca recebe identificador no envio.
  assert.deepEqual(itens.map((i) => [i.serial, Boolean(i.serialGerado)]), [['', true], ['S2', false], ['', true]]);
  const repetido = 'Serial S1 repetido nas linhas 2, 3. Cada serial só pode aparecer uma vez na planilha.';
  assert.deepEqual(errosLinha, [{ linha: 2, mensagem: repetido }, { linha: 3, mensagem: repetido }]);
  assert.deepEqual(seriaisRepetidos, [{ serial: 'S1', linhas: [2, 3] }]);
  assert.deepEqual(inconsistenciasDoLote(itens, errosLinha).map((i) => [i.titulo, i.linhas]), [['Serial repetido na planilha', [2, 3]]]);
  assert.deepEqual(seriaisDuplicados(itens), []);
  assert.deepEqual(seriaisDuplicados([{ serial: 'AB-1' }, { serial: 'ab1' }, { serial: 'C' }]), [{ serial: 'AB-1', linhas: [1, 2] }]);
});

test('inconsistencias agrupam o que bloqueia por campo, com as linhas; aviso nao trava', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', '', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Placa: 10', '', '', '', ''],
    ['S2', '', '10', 'AVARIA', 'SIM', 'NAO', 'NOVO', '', '', '', '', ''],
    ['S3', 'NF', '10', 'x', 'TALVEZ', 'NAO', 'NOVO', 'Placa: 10', '', '', '', '']
  ]);
  assert.deepEqual(inconsistenciasDoLote(itens).map((i) => [i.titulo, i.linhas]), [
    ['Nota fiscal', [2, 3]],
    ['Defeito funcional', [4]]
  ]);
  const { itens: ok } = interpretarPlanilhaOrcamento([CABECALHO, ['S9', 'NF', '10', 'AVARIA', 'SIM', 'NAO', 'NOVO', '', '', '', '', '']]);
  assert.deepEqual(inconsistenciasDoLote(ok), []);
});

test('aponta campos em branco e invalidos como pendencia que bloqueia o envio', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', 'NF', '', '', 'TALVEZ', '', 'NOVO', 'Placa; : 5; Tela: abc', '', 'xx', '', '']
  ]);
  const [item] = itens;
  assert.equal(itemBloqueado(item), true);
  const mensagens = item.pendencias.map((p) => `${p.campo}: ${p.mensagem}`);
  assert.deepEqual(mensagens, [
    'codigo: Gemco ou Código de barras em branco.',
    'defeitoEncontrado: Defeito encontrado em branco.',
    'defeitoFuncional: "TALVEZ" não é aceito: use SIM ou NAO.',
    'garantia: Garantia (SIM/NAO) em branco.',
    'valores: Peças: "Placa" sem valor (use nome: valor); ": 5" sem nome; "Tela: abc" com valor inválido.',
    'valores: Mão de obra (R$): "xx" inválido.'
  ]);
});

test('nota fiscal em branco bloqueia o envio', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S9', '', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', 'Placa: 10', '', '', '', '']
  ]);
  const [item] = itens;
  assert.equal(item.notaFiscal, '');
  assert.equal(itemBloqueado(item), true);
  assert.ok(item.pendencias.some((p) => p.campo === 'notaFiscal' && p.mensagem === 'Nota fiscal em branco.'));
});

test('avaria e total zero so avisam', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S2', 'NF', '10', 'AVARIA', 'SIM', 'NAO', 'SUCATA', '', '', '', '', '']
  ]);
  const [item] = itens;
  assert.equal(itemBloqueado(item), false);
  assert.equal(item.avaria, true);
  assert.equal(item.pendencias.length, 2);
});

test('foto so e exigida em avaria estetica; defeito funcional fica opcional', () => {
  const linha = (defeito) => ['S3', 'NF', '10', defeito, 'SIM', 'NAO', 'NOVO', 'Tampa: 10', '', '', '', ''];
  const avaria = (defeito) => interpretarPlanilhaOrcamento([CABECALHO, linha(defeito)]).itens[0].avaria;
  for (const d of ['AVARIA ESTETICA', 'Avaria estética', 'ARRANHADO / RISCADO', 'tampa amassada', 'TRINCADO', 'Tela quebrada']) {
    assert.equal(avaria(d), true, d);
  }
  for (const d of ['NAO LIGA', 'Sem imagem', 'RUIDO NO MOTOR']) {
    assert.equal(avaria(d), false, d);
  }
});

test('0, SEM SERIAL, S/ SERIAL e S/SERIAL viram serial gerado', () => {
  const marcadores = ['0', '000', 'SEM SERIAL', 'sem serial', 'S/ SERIAL', 'S/SERIAL'];
  const { itens, errosLinha } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ...marcadores.map((s, i) => [s, `NF${i}`, '10', 'NAO LIGA', 'SIM', 'NAO', 'NOVO', 'Tampa: 10', '', '', '', ''])
  ]);
  assert.equal(errosLinha.length, 0);
  assert.equal(itens.length, marcadores.length);
  for (const item of itens) {
    assert.equal(item.serial, '');
    assert.equal(item.serialGerado, true);
  }
});

test('cabecalho sem coluna obrigatoria gera erro claro', () => {
  assert.throws(() => interpretarPlanilhaOrcamento([['Serial', 'Gemco']]), /Coluna\(s\) não encontrada\(s\): Nota fiscal/);
});

test('le valores monetarios e quebra itens com valor', () => {
  assert.equal(lerValorMonetario('1.234,56'), 1234.56);
  assert.equal(lerValorMonetario('120.5'), 120.5);
  assert.equal(lerValorMonetario(''), null);
  assert.ok(Number.isNaN(lerValorMonetario('-5')));
  assert.ok(Number.isNaN(lerValorMonetario(-5)));
  assert.deepEqual(quebrarItensComValor('Placa principal: 120,50\nCabo=5;'), {
    itens: [{ nome: 'Placa principal', valor: 120.5 }, { nome: 'Cabo', valor: 5 }],
    erros: []
  });
  // Variacoes que os postos ja usam hoje.
  assert.deepEqual(quebrarItensComValor('Display: 1.300,00, Flex: 50 | Placa 220V 99,90;; Tampa - R$ 12'), {
    itens: [
      { nome: 'Display', valor: 1300 },
      { nome: 'Flex', valor: 50 },
      { nome: 'Placa 220V', valor: 99.9 },
      { nome: 'Tampa', valor: 12 }
    ],
    erros: []
  });
  assert.deepEqual(quebrarItensComValor('Display; Tela: abc').erros, ['"Display" sem valor (use nome: valor)', '"Tela: abc" com valor inválido']);
});

test('consulta o produto uma vez por codigo e monta os payloads do lote', async () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', 'NF1', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', 'Placa Ã: 100', 'Cabo: 5', '', '', ''],
    ['S2', 'NF2', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', '', '', 50, '', ''],
    ['S3', 'NF3', '99', 'Não liga', 'SIM', 'NAO', 'NOVO', '', '', 50, '', '']
  ]);
  const consultas = [];
  await consultarProdutosOrcamento(itens, async ({ item }) => {
    consultas.push(item);
    return item === '10' ? { items: [{ ITEM: '10', DS_PRODUTO: 'TV', COD_BARRA: '789', FORNECEDOR: 'ACME', LINHA: 'MARROM' }] } : { items: [] };
  });
  assert.deepEqual(consultas.sort(), ['10', '99']);
  assert.equal(itemBloqueado(itens[2]), true);
  assert.deepEqual(montarItemCadastro(itens[0], 'P1-1'), {
    protocolo: 'P1-1', uuid: '-', ean: '789', codBarras: '789', codGemco: '10', descricao: 'TV', fornecedor: 'ACME', linha: 'MARROM', serial: 'S1', notaFiscal: 'NF1', status: 0
  });
  const valores = montarValoresOrcamento(itens[0]);
  assert.equal(valores.pecasDesc, 'pe;placa a');
  assert.equal(valores.acessDesc, 'ac;cabo');
  assert.equal(valores.pecasDetalhes, JSON.stringify([{ nome: 'Placa Ã', valor: 100 }]));
  assert.equal(valores.totalOrcamento, 105);
});

test('lancamento manual usa as mesmas regras da planilha (sem UUID)', () => {
  const { interpretarItemManual } = compiled.exports;
  const { item } = interpretarItemManual({
    serial: 'abc12345', notaFiscal: 'NF-9', codigo: '123456', defeitoEncontrado: 'Nao liga',
    defeitoFuncional: 'SIM', garantia: 'NAO', avariaEstetica: 'NAO', tipoOrc: 'NOVO',
    pecas: 'Display: 300,50; Flex: 50', acessorios: '', maoObra: '20', embalagem: '', higienizacao: ''
  }, 3);
  assert.equal(item.serial, 'ABC1-2345');
  assert.equal(item.linha, 3);
  assert.equal(item.total, 370.5);
  assert.deepEqual(item.pendencias, []);
  assert.equal(itemBloqueado(item), false);

  const semNf = interpretarItemManual({ serial: 'x1', codigo: '1', defeitoEncontrado: 'a', defeitoFuncional: 'SIM', garantia: 'SIM', tipoOrc: 'NOVO', pecas: 'Display' }).item;
  assert.equal(itemBloqueado(semNf), true);
  assert.ok(semNf.pendencias.some((p) => p.campo === 'notaFiscal'));
  assert.ok(semNf.pendencias.some((p) => /sem valor/.test(p.mensagem)));

  const semSerial = interpretarItemManual({ notaFiscal: 'NF', codigo: '1', defeitoEncontrado: 'a', defeitoFuncional: 'SIM', garantia: 'SIM', avariaEstetica: 'NAO', tipoOrc: 'NOVO' }).item;
  assert.equal(semSerial.serial, '');
  assert.equal(semSerial.serialGerado, true);
  assert.equal(itemBloqueado(semSerial), false);
  assert.ok(interpretarItemManual({}).erro);

  // No lancamento manual a avaria estetica e obrigatoria (mesma regra da planilha nova).
  const semAvaria = interpretarItemManual({ serial: 'x2', notaFiscal: 'NF', codigo: '1', defeitoEncontrado: 'a', defeitoFuncional: 'SIM', garantia: 'SIM', tipoOrc: 'NOVO' }).item;
  assert.ok(semAvaria.pendencias.some((p) => p.campo === 'avariaEstetica' && p.bloqueia));
});

test('coluna Avaria estetica: SIM exige foto (bloqueia), NAO deixa a foto opcional', () => {
  const { definirEvidencias, AVISO_AVARIA_FOTO_OBRIGATORIA } = compiled.exports;
  const CAB = [...CABECALHO.slice(0, 6), 'Avaria estética (SIM/NAO)', ...CABECALHO.slice(6)];
  const linha = (serial, defeito, avaria) => [serial, 'NF', '10', defeito, 'SIM', 'NAO', avaria, 'NOVO', 'Tampa: 10', '', '', '', ''];
  const { itens } = interpretarPlanilhaOrcamento([CAB,
    linha('S1', 'Não liga', 'SIM'), linha('S2', 'Tela quebrada', 'NAO'), linha('S3', 'x', ''), linha('S4', 'x', 'talvez'), linha('S5', 'x', 'n')]);
  const [sim, nao, branco, invalido, abreviado] = itens;

  assert.deepEqual([sim.avaria, sim.avariaEstetica], [true, 'SIM']);
  assert.equal(itemBloqueado(sim), true);
  assert.ok(sim.pendencias.some((p) => p.mensagem === AVISO_AVARIA_FOTO_OBRIGATORIA && p.bloqueia));
  // Com foto, libera; tirando a foto, volta a bloquear.
  definirEvidencias(sim, [{ name: 'f.jpg' }]);
  assert.equal(itemBloqueado(sim), false);
  definirEvidencias(sim, []);
  assert.equal(itemBloqueado(sim), true);

  // NAO vale mesmo com "quebrada" no defeito: o posto informou que nao ha avaria estetica.
  assert.deepEqual([nao.avaria, nao.avariaEstetica, itemBloqueado(nao)], [false, 'NAO', false]);
  assert.deepEqual(nao.pendencias, []);
  assert.ok(branco.pendencias.some((p) => p.campo === 'avariaEstetica' && p.bloqueia && /em branco/.test(p.mensagem)));
  assert.ok(invalido.pendencias.some((p) => p.campo === 'avariaEstetica' && /"talvez"/.test(p.mensagem)));
  assert.equal(abreviado.avariaEstetica, 'NAO');
  assert.deepEqual(inconsistenciasDoLote(itens).map((i) => [i.titulo, i.linhas]), [['Avaria estética', [2, 4, 5]]]);
});

test('planilha antiga (sem a coluna Avaria estetica) continua: avaria pelo defeito, sem foto so avisa', () => {
  const { itens } = interpretarPlanilhaOrcamento([CABECALHO, ['S1', 'NF', '10', 'Tela quebrada', 'SIM', 'NAO', 'NOVO', 'Tela: 10', '', '', '', '']]);
  assert.equal(itens[0].avaria, true);
  assert.equal(itens[0].avariaEstetica, undefined);
  assert.equal(itemBloqueado(itens[0]), false);
});
