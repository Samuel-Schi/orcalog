import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/pagamentosConsolidado.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { consolidarPagamentosPorProtocolo } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('Kirk acompanha a nota mais recente sem perder zeros ou prefixos', () => {
  const [pagamento] = consolidarPagamentosPorProtocolo([
    { protocolo: 'P1', nota_fiscal_numero: '1', kirk_numero: 'antigo', nota_fiscal_enviada_em: '2026-01-01' },
    { protocolo: 'P1', nota_fiscal_numero: '2', kirk_numero: 'K-00123', nota_fiscal_enviada_em: '2026-02-01' }
  ]);
  assert.equal(pagamento.nota_fiscal_numero, '2');
  assert.equal(pagamento.kirk_numero, 'K-00123');
});

test('consolida itens por protocolo usando valor negociado aprovado', () => {
  const [protocolo] = consolidarPagamentosPorProtocolo([
    { id: 47, oracle_item_id: 303, protocolo: '1234', total_orcamento: 1000, status: 10, status_text: 'APROVADO' },
    { id: 48, oracle_item_id: 304, protocolo: '1234', total_orcamento: 200, status: 10, status_text: 'REPROVADO' }
  ], [
    { protocolo: '1234', status: 'ACEITA_POSTO', negotiation_scope: 'ITEM', item_ids: ['47'], valor_proposto_at: 500 }
  ]);

  assert.equal(protocolo.protocolo, '1234');
  assert.equal(protocolo.total_protocolo, 500);
  assert.equal(protocolo.quantidade_itens, 2);
  assert.equal(protocolo.itens_aprovados, 1);
  assert.equal(protocolo.itens_reprovados, 1);
});

test('soma acordo coletivo uma unica vez no protocolo', () => {
  const [protocolo] = consolidarPagamentosPorProtocolo([
    { id: 1, oracle_item_id: 10, protocolo: 'LOTE-1', total_orcamento: 600, status: 10, status_text: 'APROVADO' },
    { id: 2, oracle_item_id: 11, protocolo: 'LOTE-1', total_orcamento: 400, status: 10, status_text: 'APROVADO' }
  ], [
    { protocolo: 'LOTE-1', status: 'ACEITA_POSTO', negotiation_scope: 'LOTE', item_ids: [], valor_proposto_at: 700 }
  ]);

  assert.equal(protocolo.total_protocolo, 700);
});
