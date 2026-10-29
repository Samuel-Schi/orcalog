import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/romaneioClassificacao.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { agruparPorClassificacao, classificacaoRomaneio, tituloGrupo } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('romaneio separa Saldo A, depois reprovados, depois o resto e sem classificacao por ultimo', () => {
  const itens = [
    { id: 1, tipoOrc: 'SUCATA' },
    { id: 2, tipoOrc: 'saldo a' },
    { id: 3, tipoOrc: 'SALDO A', statusText: 'REPROVADO' },
    { id: 4, tipoOrc: '' },
    { id: 5, tipoOrc: 'NOVO' },
    { id: 6, tipoOrc: 'SALDO  A' },
    { id: 7, tipoOrc: 'OUTRA' }
  ];
  const grupos = agruparPorClassificacao(itens).map((g) => [g.classificacao, g.itens.map((i) => i.id)]);
  assert.deepEqual(grupos, [
    ['SALDO A', [2, 6]],
    ['REPROVADO', [3]],
    ['NOVO', [5]],
    ['SUCATA', [1]],
    ['OUTRA', [7]],
    ['SEM CLASSIFICACAO', [4]]
  ]);
});

test('reprovado ganha da classificacao e o titulo mostra a quantidade', () => {
  assert.equal(classificacaoRomaneio({ tipoOrc: 'GARANTIA', statusText: ' reprovado ' }), 'REPROVADO');
  assert.equal(classificacaoRomaneio({ tipoOrc: 'GARANTIA', statusText: 'APROVADO' }), 'GARANTIA');
  assert.equal(tituloGrupo('REPROVADO', 2), 'REPROVADOS - 2 itens');
  assert.equal(tituloGrupo('SALDO A', 1), 'SALDO A - 1 item');
});
