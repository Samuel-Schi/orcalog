import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/pecaPadrao.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { indexarCatalogo, padronizarPeca, normalizarNome } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

// Catalogo de teste espelhando o real: PLACA PRINCIPAL so em TE/IN; ALTO-FALANTE com alias SPEAKER.
const padroes = [
  { codigo: 'PEC0001', nomeCanonico: 'PLACA PRINCIPAL', tipo: 'PECA' },
  { codigo: 'PEC0002', nomeCanonico: 'PLACA PRINCIPAL DA EVAPORADORA', tipo: 'PECA' },
  { codigo: 'PEC0017', nomeCanonico: 'ALTO-FALANTE', tipo: 'PECA' },
  { codigo: 'PEC0030', nomeCanonico: 'COMPRESSOR HERMETICO', tipo: 'PECA' }
];
const linhas = [
  { codigo: 'PEC0001', linha: 'TE - TELEFONIA' },
  { codigo: 'PEC0001', linha: 'IN - INFORMATICA' },
  { codigo: 'PEC0002', linha: 'ED1 - ELETRO 1' },
  { codigo: 'PEC0017', linha: 'EA - AUDIO' },
  { codigo: 'PEC0030', linha: 'ED1 - ELETRO 1' }
];
const aliases = [
  { codigo: 'PEC0017', alias: 'SPEAKER' },
  { codigo: 'PEC0017', alias: 'ALTO-FALANTE / SPEAKER' }
];
const catalogo = indexarCatalogo(padroes, linhas, aliases);

test('match exato normaliza acento e caixa', () => {
  const r = padronizarPeca('placa principal', catalogo, 'TE - TELEFONIA');
  assert.equal(r.status, 'padronizada');
  assert.equal(r.canonico, 'PLACA PRINCIPAL');
  assert.equal(r.linhaOk, true);
});

test('alias SPEAKER vira ALTO-FALANTE', () => {
  const r = padronizarPeca('Speaker', catalogo, 'EA - AUDIO');
  assert.equal(r.status, 'padronizada');
  assert.equal(r.canonico, 'ALTO-FALANTE');
  assert.equal(r.codigo, 'PEC0017');
});

test('guarda de linha: PLACA PRINCIPAL nao pertence a ED1', () => {
  const r = padronizarPeca('PLACA PRINCIPAL', catalogo, 'ED1 - ELETRO 1');
  assert.equal(r.status, 'padronizada');
  assert.equal(r.linhaOk, false); // casa o nome, mas sinaliza linha errada
});

test('granularidade diferente pede revisao, nao padroniza calado', () => {
  const r = padronizarPeca('PLACA', catalogo, 'ED1 - ELETRO 1');
  assert.equal(r.status, 'revisar');
  assert.ok(r.sugestao && r.sugestao.startsWith('PLACA'));
  assert.equal(r.canonico, null); // nunca reescreve sozinho
});

test('nome desconhecido vira nova', () => {
  const r = padronizarPeca('XPTO 9000 INEXISTENTE', catalogo, 'ED1 - ELETRO 1');
  assert.equal(r.status, 'nova');
  assert.equal(r.canonico, null);
});

test('sem linha informada, linhaOk fica null', () => {
  const r = padronizarPeca('COMPRESSOR HERMETICO', catalogo, null);
  assert.equal(r.status, 'padronizada');
  assert.equal(r.linhaOk, null);
});

test('normalizarNome colapsa espaco e remove acento', () => {
  assert.equal(normalizarNome('  Plãca   Principal '), 'PLACA PRINCIPAL');
});
