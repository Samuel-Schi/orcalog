import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/statusMap.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { isLoteFinalizado } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('lote vai para Finalizados so com todos os itens finalizados (4 ou 10)', () => {
  assert.equal(isLoteFinalizado([{ status: 4 }, { status: '10' }]), true);
  assert.equal(isLoteFinalizado([{ status: 4 }, { status: 7 }]), false, 'item em negociacao mantem o lote em andamento');
  assert.equal(isLoteFinalizado([{ status: 8 }]), false);
});

test('lote incompleto ou vazio continua em andamento', () => {
  assert.equal(isLoteFinalizado([{ status: 4 }], 2), false, 'faltam itens do lote');
  assert.equal(isLoteFinalizado([]), false);
});
