import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/resultadoOrcamento.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { resultadoItem, valorFinalItem, valorAceito } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const item = { supabaseId: '47', status: 10, statusText: 'APROVADO', totalOrcamento: 1000 };
const negociacao = { status: 'ACEITA_POSTO', negotiation_scope: 'ITEM', item_ids: ['47'], valor_proposto_at: 500, valor_contraproposta_posto: 800 };

test('retificacao zera o valor mesmo com negociacao aceita anterior', () => {
  const retificado = { ...item, statusText: 'RETIFICADO' };
  assert.equal(resultadoItem(retificado), 'Retificado');
  assert.equal(valorFinalItem(retificado, negociacao), 0);
});

test('separa original e acordo aceito, mesmo havendo contraproposta antiga', () => {
  assert.equal(valorFinalItem(item, negociacao), 500);
  assert.equal(item.totalOrcamento, 1000);
  assert.equal(resultadoItem(item), 'Aprovado');
});
test('codigo finalizado nao confunde reprovacao com aprovacao', () => {
  const reprovado = { ...item, statusText: 'REPROVADO' };
  assert.equal(resultadoItem(reprovado), 'Reprovado');
  assert.equal(valorFinalItem(reprovado, negociacao), 0);
  assert.equal(resultadoItem({ ...item, statusText: null }), 'Aguardando análise');
});
test('negociacao usa o ID Supabase e nao afeta outros itens', () => {
  assert.equal(valorFinalItem({ ...item, supabaseId: '48' }, negociacao), 1000);
});
test('proposta pendente nao vira valor aprovado', () => {
  assert.equal(valorFinalItem(item, { ...negociacao, status: 'CONTRAPROPOSTA_POSTO' }), null);
  assert.equal(valorFinalItem({ ...item, status: 7, statusText: 'EM_NEGOCIACAO' }, negociacao), null);
});
test('valor coletivo nao e multiplicado pelas linhas', () => {
  const lote = { ...negociacao, negotiation_scope: 'LOTE', item_ids: [] };
  assert.equal(valorAceito(lote), 500);
  assert.equal(valorFinalItem(item, lote), null);
  assert.equal(valorFinalItem(item, { ...negociacao, item_ids: ['47', '48'] }), null);
});
test('sem negociacao usa o total aprovado e preserva zero', () => {
  assert.equal(valorFinalItem(item), 1000);
  assert.equal(valorFinalItem({ ...item, totalOrcamento: 0 }), 0);
});

test('rateio persistido é o valor oficial mesmo com negociação coletiva', () => {
  assert.equal(valorFinalItem({...item,negociacaoAplicada:true,totalOrcamento:83.34},{...negociacao,negotiation_scope:'LOTE'}),83.34);
  assert.equal(valorFinalItem({...item,negociacaoAplicada:true,totalOrcamento:0,statusText:'RETIFICADO'},negociacao),0);
});
