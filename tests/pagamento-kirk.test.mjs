import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['netlify/functions/save-pagamento-supabase.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const filename = path.resolve('netlify/functions/pagamento-kirk.test.cjs');
const compiled = new Module(filename);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(outputFiles[0].text, filename);
const { handler } = compiled.exports;
const payload = {
  protocolo: 'P1', cnpj: '12345678000199', notaFiscalNome: 'nf.pdf',
  notaFiscalDriveLink: 'https://drive.google.com/drive/folders/test',
  notaFiscalNumero: '001', valorPagamento: 100, kirkNumero: ' K-00123 '
};

test('salva Kirk junto da nota, restrito ao protocolo e CNPJ', async () => {
  const original = globalThis.fetch;
  const previous = { ...process.env };
  let saved;
  try {
    process.env.SUPABASE_ORCAMENTOS_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY = 'test-only';
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('cnpj'), 'eq.' + payload.cnpj);
      assert.equal(parsed.searchParams.get('protocolo'), 'eq.P1');
      if (init.method === 'PATCH') {
        saved = JSON.parse(init.body);
        return new Response(JSON.stringify([saved]));
      }
      if (parsed.pathname.endsWith('/orcamento_negociacoes')) return new Response('[]');
      return new Response(JSON.stringify([{ id: 1, protocolo: 'P1', status: 10, status_text: 'APROVADO', total_orcamento: 100 }]));
    };
    const response = await handler({ httpMethod: 'POST', body: JSON.stringify(payload) }, {});
    assert.equal(response.statusCode, 200);
    assert.equal(saved.kirk_numero, 'K-00123');
    assert.equal(saved.nota_fiscal_numero, '001');
  } finally {
    globalThis.fetch = original;
    for (const key of ['SUPABASE_ORCAMENTOS_URL', 'SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
});

test('rejeita Kirk muito longo antes de persistir nota', async () => {
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify({ ...payload, kirkNumero: '1'.repeat(81) }) }, {});
  assert.equal(response.statusCode, 400);
});
