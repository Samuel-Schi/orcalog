import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import * as XLSX from 'xlsx';

const { outputFiles } = await build({ entryPoints: ['src/lib/importacaoProdutos.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const compiled = new Module(path.resolve('src/lib/importacao-produtos.test.cjs'));
compiled._compile(outputFiles[0].text, compiled.id);
const { ErroImportacao, consultarCodigoBarras, consultarProdutoPorCodigo, validarItemManual, extrairProdutoApi, importarProdutos, lerPlanilhaExcel, motivoProdutoRepetido, validarArquivoExcel } = compiled.exports;

const planilha = (linhas, bookType = 'xlsx') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(linhas), 'Produtos');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType }));
};

let ids = 0;
const criarId = () => `id-${++ids}`;
const produtoApi = (item) => ({ items: [{ ITEM: item, DS_PRODUTO: `Produto ${item}`, COD_BARRA: '7891234567890', FORNECEDOR: 'ACME', LINHA: 'BRANCA' }] });

test('le xlsx com cabecalho acentuado, numeros longos e numeracao real das linhas', async () => {
  const { linhas, erros } = await lerPlanilhaExcel(planilha([
    ['ID único', 'Serial', 'Gemco'],
    [123456789012345, 'abc12345', 998877],
    ['', '', ''],
    ['55', '', '112233'],
    ['', 'zz99', '']
  ]));
  assert.deepEqual(linhas, [{ linha: 2, uuid: '123456789012345', serial: 'ABC1-2345', codGemco: '998877' }]);
  assert.deepEqual(erros.map((e) => [e.linha, e.mensagem]), [
    [4, 'Serial não informado.'],
    [5, 'Informe o Gemco ou o ID único para consultar o produto.']
  ]);
});

test('aceita .xls e cabecalho abaixo de linhas de titulo', async () => {
  const { linhas } = await lerPlanilhaExcel(planilha([['Relatório de produtos'], [], ['SERIAL', 'GEMCO', 'ID UNICO'], ['s1', '10', '20']], 'biff8'));
  assert.deepEqual(linhas, [{ linha: 4, uuid: '20', serial: 'S1', codGemco: '10' }]);
});

test('rejeita planilha sem colunas obrigatorias, vazia ou corrompida', async () => {
  await assert.rejects(lerPlanilhaExcel(planilha([['ID único', 'Serial'], ['1', 'a']])), (e) => e instanceof ErroImportacao && /Gemco/.test(e.message));
  await assert.rejects(lerPlanilhaExcel(planilha([['ID único', 'Serial', 'Gemco']])), /não possui linhas/);
  await assert.rejects(lerPlanilhaExcel(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), ErroImportacao);
});

test('valida extensao e tamanho do arquivo', () => {
  assert.throws(() => validarArquivoExcel({ name: 'produtos.csv', size: 10 }), /\.xlsx ou \.xls/);
  assert.throws(() => validarArquivoExcel({ name: 'produtos.xlsx', size: 0 }), /vazio/);
  assert.throws(() => validarArquivoExcel({ name: 'produtos.xls', size: 6 * 1024 * 1024 }), /5 MB/);
  assert.doesNotThrow(() => validarArquivoExcel({ name: 'PRODUTOS.XLSX', size: 10 }));
});

test('extrai campos da API independente de maiusculas e formato da resposta', () => {
  assert.deepEqual(extrairProdutoApi(produtoApi('42')), { codGemco: '42', descricao: 'Produto 42', ean: '7891234567890', uuid: '', fornecedor: 'ACME', linha: 'BRANCA' });
  assert.equal(extrairProdutoApi({ items: [] }).descricao, '');
  assert.equal(extrairProdutoApi([{ descricao: 'X' }]).descricao, 'X');
});

test('importa, atualiza existente sem duplicar e reporta erros por linha', async () => {
  const existente = { id: 'antigo', protocolo: 'P1', uuid: '-', ean: '-', codGemco: '20', descricao: 'Velho', fornecedor: '-', linha: '-', serial: 'S2', status: 0 };
  const progresso = [];
  const consultas = [];
  const { itens, resultados } = await importarProdutos({
    linhas: [
      { linha: 2, uuid: '1', serial: 'S1', codGemco: '10' },
      { linha: 3, uuid: '', serial: 'S2', codGemco: '20' },
      { linha: 4, uuid: '', serial: 'S3', codGemco: '404' },
      { linha: 5, uuid: '', serial: 'S4', codGemco: '500' },
      { linha: 6, uuid: '', serial: 'S1', codGemco: '10' },
      { linha: 7, uuid: '777', serial: 'S5', codGemco: '' }
    ],
    itensAtuais: [existente],
    protocolo: 'P1',
    criarId,
    consultar: async ({ item }) => {
      consultas.push(item);
      if (item === '404') return { items: [] };
      if (item === '500') throw new Error('Timeout.');
      return produtoApi(item === '777' ? '30' : item);
    },
    onProgresso: (feitas, total) => progresso.push([feitas, total])
  });

  assert.deepEqual(resultados.map((r) => [r.linha, r.status]), [[2, 'importado'], [3, 'atualizado'], [4, 'erro'], [5, 'erro'], [6, 'erro'], [7, 'importado']]);
  assert.match(resultados[2].mensagem, /não encontrado/);
  assert.match(resultados[3].mensagem, /Falha ao consultar a API\. Timeout\./);
  assert.match(resultados[4].mensagem, /duplicada.*linha 2/);
  assert.equal(consultas.length, 5, 'linha duplicada no arquivo nao consulta a API');
  assert.deepEqual(progresso.at(-1), [5, 5]);

  assert.equal(itens.length, 3);
  assert.deepEqual(itens[0], { ...existente, descricao: 'Produto 20', ean: '7891234567890', fornecedor: 'ACME', linha: 'BRANCA' });
  assert.equal(itens[1].descricao, 'Produto 10');
  assert.equal(itens[1].protocolo, 'P1');
  assert.equal(itens[2].codGemco, '30', 'sem Gemco na planilha usa o codigo retornado pela API');
  assert.equal(itens[2].uuid, '777');
});

test('reimportar o mesmo arquivo nao duplica produtos', async () => {
  const linhas = [{ linha: 2, uuid: '', serial: 'AB-CD', codGemco: '10' }];
  const opcoes = { protocolo: 'P1', criarId, consultar: async ({ item }) => produtoApi(item) };
  const primeira = await importarProdutos({ ...opcoes, linhas, itensAtuais: [] });
  const segunda = await importarProdutos({ ...opcoes, linhas: [{ ...linhas[0], serial: 'ABCD' }], itensAtuais: primeira.itens });
  assert.equal(segunda.itens.length, 1);
  assert.equal(segunda.resultados[0].status, 'atualizado');
});

test('serial e ID unico nao se repetem no protocolo', () => {
  const itens = [{ serial: 'ABC1-2345', uuid: '777' }, { serial: 'X1', uuid: '-' }];
  assert.equal(motivoProdutoRepetido({ serial: 'abc12345', uuid: '1' }, itens), 'Este serial já está no protocolo.');
  assert.equal(motivoProdutoRepetido({ serial: 'NOVO', uuid: '777' }, itens), 'Este ID único já está no protocolo.');
  assert.equal(motivoProdutoRepetido({ serial: 'NOVO', uuid: '-' }, itens), '', 'ID unico nao informado nao conta como repetido');
  assert.equal(motivoProdutoRepetido({ serial: 'NOVO', uuid: '' }, itens), '');
});

test('importacao recusa serial ou ID unico repetido, mesmo com Gemco diferente', async () => {
  const existente = { id: 'antigo', protocolo: 'P1', uuid: '900', ean: '-', codGemco: '20', descricao: 'Velho', fornecedor: '-', linha: '-', serial: 'S1', status: 0 };
  const { itens, resultados } = await importarProdutos({
    linhas: [
      { linha: 2, uuid: '', serial: 'S1', codGemco: '30' },
      { linha: 3, uuid: '900', serial: 'S2', codGemco: '40' },
      { linha: 4, uuid: '55', serial: 'S3', codGemco: '50' },
      { linha: 5, uuid: '55', serial: 'S4', codGemco: '60' },
      { linha: 6, uuid: '', serial: 'S3', codGemco: '70' }
    ],
    itensAtuais: [existente],
    protocolo: 'P1',
    criarId,
    consultar: async ({ item }) => produtoApi(item)
  });
  assert.deepEqual(resultados.map((r) => [r.linha, r.status, r.mensagem]), [
    [2, 'erro', 'Este serial já está no protocolo.'],
    [3, 'erro', 'Este ID único já está no protocolo.'],
    [4, 'importado', 'Produto importado.'],
    [5, 'erro', 'Linha duplicada no arquivo (mesmo ID único da linha 4).'],
    [6, 'erro', 'Linha duplicada no arquivo (mesmo serial da linha 4).']
  ]);
  assert.equal(itens.length, 2);
});

test('codigo de barras manual: preenche descricao, fornecedor e linha', async () => {
  const chamadas = [];
  const resultado = await consultarCodigoBarras(' 789-1234567890 ', async (codigo) => {
    chamadas.push(codigo);
    return { items: [{ ds_produto: 'Geladeira', nome_fornecedor: 'ACME', ds_linha: 'BRANCA', item: '42' }] };
  });
  assert.deepEqual(chamadas, ['7891234567890']);
  assert.equal(resultado.status, 'encontrado');
  assert.deepEqual(resultado.produto, { codGemco: '42', descricao: 'Geladeira', ean: '7891234567890', uuid: '', fornecedor: 'ACME', linha: 'BRANCA' });
});

test('codigo de barras manual: mensagens para nao encontrado, invalido e falha da API', async () => {
  assert.equal((await consultarCodigoBarras('7891234567890', async () => ({ items: [] }))).status, 'nao_encontrado');
  const http404 = Object.assign(new Error('404'), { response: { status: 404 } });
  assert.equal((await consultarCodigoBarras('7891234567890', async () => { throw http404; })).status, 'nao_encontrado');
  const falha = await consultarCodigoBarras('7891234567890', async () => { throw new Error('Network Error'); });
  assert.equal(falha.status, 'erro');
  assert.match(falha.mensagem, /Não foi possível consultar/);
  let consultou = false;
  const curto = await consultarCodigoBarras('123', async () => { consultou = true; });
  assert.equal(curto.status, 'erro');
  assert.match(curto.mensagem, /ao menos 8 dígitos/);
  assert.equal(consultou, false);
});

test('digitar manual: Gemco busca descricao, fornecedor, linha e codigo de barras', async () => {
  const chamadas = [];
  const resultado = await consultarProdutoPorCodigo('gemco', ' 998-877 ', async (codigo) => {
    chamadas.push(codigo);
    return { items: [{ ds_produto: 'Fogao', fornecedor: 'ACME', linha: 'BRANCA', cod_barra: '7890000000001' }] };
  });
  assert.deepEqual(chamadas, ['998877']);
  assert.equal(resultado.status, 'encontrado');
  assert.deepEqual(resultado.produto, { codGemco: '998877', descricao: 'Fogao', ean: '7890000000001', uuid: '', fornecedor: 'ACME', linha: 'BRANCA' });
  assert.match(resultado.mensagem, /pelo Gemco/);
  const naoAchou = await consultarProdutoPorCodigo('gemco', '123', async () => ({ items: [] }));
  assert.equal(naoAchou.status, 'nao_encontrado');
  assert.match(naoAchou.mensagem, /Gemco 123 não encontrado/);
});

test('digitar manual: serial e ID unico obrigatorios, Gemco ou codigo de barras basta um', () => {
  const base = { serial: 'S1', uuid: '123', codGemco: '', ean: '', descricao: 'Fogao' };
  assert.equal(validarItemManual({ ...base, codGemco: '10' }), '');
  assert.equal(validarItemManual({ ...base, ean: '7890000000001' }), '');
  assert.match(validarItemManual(base), /Gemco ou o código de barras/);
  assert.match(validarItemManual({ ...base, codGemco: '10', serial: ' ' }), /serial/);
  assert.match(validarItemManual({ ...base, codGemco: '10', uuid: '' }), /ID único/);
  assert.match(validarItemManual({ ...base, codGemco: '10', descricao: '' }), /descricao/);
});

test('EAN digitado no campo Gemco usa o Gemco devolvido pela API', async () => {
  // Resposta real de get_produto_cadastro?item=7898541352015&codigo_barra=7898541352015
  const resultado = await consultarProdutoPorCodigo('gemco', '7898541352015', async () => ({
    items: [{ item: '4626145', descricao: 'CAIXA PORTA TRECOS COM ASSENTO', cod_barra: '7898541352015', fornecedor: 'COMPLETA IND. D', linha: 'MO1 - QUARTO E ESCRITORIO' }],
    hasMore: false, count: 1
  }));
  assert.equal(resultado.status, 'encontrado');
  assert.equal(resultado.produto.codGemco, '4626145');
  assert.equal(resultado.produto.ean, '7898541352015');
  assert.equal(resultado.produto.linha, 'MO1 - QUARTO E ESCRITORIO');
});
