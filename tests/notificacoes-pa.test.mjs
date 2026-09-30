import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['netlify/functions/notificacoes-pa.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false
});
const filename = path.resolve('netlify/functions/notificacoes-pa.test.cjs');
const compiled = new Module(filename);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(outputFiles[0].text, filename);
const handler = compiled.exports.createNotificationsHandler({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only'
});
const cnpj = '12345678000199';

test('consulta somente avisos não lidos do CNPJ informado', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('cnpj'), 'eq.' + cnpj);
      assert.equal(params.get('lida_em'), 'is.null');
      assert.equal(params.get('limit'), '100');
      return new Response(JSON.stringify([{ id: 1, protocolo: 'P1' }]));
    };
    const result = await handler({ httpMethod: 'GET', queryStringParameters: { cnpj } }, {});
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body)[0].id, 1);
  } finally { globalThis.fetch = original; }
});

test('marcar como lido restringe atualização ao ID e ao posto', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('cnpj'), 'eq.' + cnpj);
      assert.equal(params.get('id'), 'eq.12');
      assert.equal(init.method, 'PATCH');
      assert.ok(JSON.parse(init.body).lida_em);
      return new Response('[]');
    };
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ cnpj, id: 12 }) }, {});
    assert.equal(result.statusCode, 200);
  } finally { globalThis.fetch = original; }
});

test('rejeita ausência de CNPJ e ID inválido sem consultar banco', async () => {
  assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: {} }, {})).statusCode, 400);
  assert.equal((await handler({ httpMethod: 'POST', body: JSON.stringify({ cnpj, id: '1&cnpj=other' }) }, {})).statusCode, 400);
});

test('falha do banco não é apresentada como lista vazia', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('missing table', { status: 404 });
    assert.equal((await handler({ httpMethod: 'GET', queryStringParameters: { cnpj } }, {})).statusCode, 503);
  } finally { globalThis.fetch = original; }
});
