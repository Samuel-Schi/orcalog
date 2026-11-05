import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';

const { outputFiles } = await build({ entryPoints: ['src/lib/importacaoOrcamento.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const compiled = new Module(path.resolve('src/lib/importacao-orcamento.test.cjs'));
compiled._compile(outputFiles[0].text, compiled.id);
const { consultarProdutosOrcamento, interpretarPlanilhaOrcamento, itemBloqueado, lerPlanilhaOrcamento, lerValorMonetario, marcarSeriaisJaEnviados, montarItemCadastro, montarValoresOrcamento, quebrarItensComValor } = compiled.exports;

const CABECALHO = ['Serial', 'Gemco ou Código de barras', 'Defeito encontrado', 'Defeito funcional (SIM/NAO)', 'Garantia (SIM/NAO)', 'Tipo Orc.', 'Peças (nome: valor; nome: valor)', 'Acessórios (nome: valor; nome: valor)', 'Mão de obra (R$)', 'Embalagem (R$)', 'Higienização (R$)'];

const planilha = (linhas) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(linhas), 'Orçamento');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
};

test('uma linha por produto: quebra pecas e acessorios e soma os valores', async () => {
  const { itens, errosLinha } = await lerPlanilhaOrcamento(planilha([
    CABECALHO,
    ['abc12345', 123456, 'Tela quebrada', 'sim', 'Não', 'novo', 'Display: 300; Flex: R$ 1.020,00', 'Controle = 35', '80,50', '', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['xyz999', '7891234567890', 'Não liga', 'NAO', 'NAO', 'Saldo A', '', '', '', 10, 15]
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

test('serial repetido em outra linha e erro', () => {
  const { itens, errosLinha } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Placa: 10', '', '', '', ''],
    ['s1', '10', 'x', 'SIM', 'NAO', 'NOVO', 'Tela: 10', '', '', '', ''],
    ['', '10', 'x', 'SIM', 'NAO', 'NOVO', '', '', '', '', '']
  ]);
  assert.equal(itens.length, 1);
  assert.deepEqual(errosLinha, [
    { linha: 3, mensagem: 'Serial S1 repetido (já está na linha 2). Use uma linha por produto.' },
    { linha: 4, mensagem: 'Serial em branco.' }
  ]);
});

test('aponta campos em branco e invalidos como pendencia que bloqueia o envio', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S1', '', '', 'TALVEZ', '', 'NOVO', 'Placa; : 5; Tela: abc', '', 'xx', '', '']
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

test('avaria e total zero so avisam', () => {
  const { itens } = interpretarPlanilhaOrcamento([
    CABECALHO,
    ['S2', '10', 'AVARIA', 'SIM', 'NAO', 'SUCATA', '', '', '', '', '']
  ]);
  const [item] = itens;
  assert.equal(itemBloqueado(item), false);
  assert.equal(item.avaria, true);
  assert.equal(item.pendencias.length, 2);
});

test('serial em lote aberto do posto bloqueia; finalizado, cancelado e o proprio lote liberam', () => {
  const linha = (serial) => [serial, '10', 'x', 'SIM', 'NAO', 'NOVO', 'Placa: 10', '', '', '', ''];
  const { itens } = interpretarPlanilhaOrcamento([CABECALHO, linha('ABERTO1'), linha('FINAL1'), linha('CANC1'), linha('PROPRIO1'), linha('NOVO1')]);
  const bloqueados = marcarSeriaisJaEnviados(itens, [
    { serial: 'ABER-TO1', protocolo: 'P1-1000', status: 8 },
    { serial: 'FINAL1', protocolo: 'P1-1001', status: 4 },
    { serial: 'CANC1', protocolo: 'P1-1002', status: 0, cancelamento: '2026-11-01' },
    { serial: 'PROPRIO1', protocolo: 'P5-5555', status: 8 }
  ], 'P5-5555');
  assert.deepEqual(bloqueados, ['ABER-TO1']);
  assert.match(itens[0].pendencias[0].mensagem, /lote P1-1000/);
  assert.deepEqual(itens.map(itemBloqueado), [true, false, false, false, false]);
  // Conferir de novo nao acumula a mesma pendencia.
  marcarSeriaisJaEnviados(itens, [{ serial: 'ABERTO1', protocolo: 'P1-1000', status: 3 }], 'P5-5555');
  assert.equal(itens[0].pendencias.filter((p) => p.campo === 'serial').length, 1);
});

test('cabecalho sem coluna obrigatoria gera erro claro', () => {
  assert.throws(() => interpretarPlanilhaOrcamento([['Serial', 'Gemco']]), /Coluna\(s\) não encontrada\(s\): Defeito encontrado/);
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
    ['S1', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', 'Placa Ã: 100', 'Cabo: 5', '', '', ''],
    ['S2', '10', 'Não liga', 'SIM', 'NAO', 'NOVO', '', '', 50, '', ''],
    ['S3', '99', 'Não liga', 'SIM', 'NAO', 'NOVO', '', '', 50, '', '']
  ]);
  const consultas = [];
  await consultarProdutosOrcamento(itens, async ({ item }) => {
    consultas.push(item);
    return item === '10' ? { items: [{ ITEM: '10', DS_PRODUTO: 'TV', COD_BARRA: '789', FORNECEDOR: 'ACME', LINHA: 'MARROM' }] } : { items: [] };
  });
  assert.deepEqual(consultas.sort(), ['10', '99']);
  assert.equal(itemBloqueado(itens[2]), true);
  assert.deepEqual(montarItemCadastro(itens[0], 'P1-1'), {
    protocolo: 'P1-1', uuid: '-', ean: '789', codBarras: '789', codGemco: '10', descricao: 'TV', fornecedor: 'ACME', linha: 'MARROM', serial: 'S1', status: 0
  });
  const valores = montarValoresOrcamento(itens[0]);
  assert.equal(valores.pecasDesc, 'pe;placa a');
  assert.equal(valores.acessDesc, 'ac;cabo');
  assert.equal(valores.pecasDetalhes, JSON.stringify([{ nome: 'Placa Ã', valor: 100 }]));
  assert.equal(valores.totalOrcamento, 105);
});
