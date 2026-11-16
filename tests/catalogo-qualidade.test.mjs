import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const { outputFiles } = await build({ entryPoints: ['netlify/functions/get-catalogo-qualidade.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const caminho = path.resolve('netlify/functions/get-catalogo-qualidade.test.cjs');
const modulo = new Module(caminho);
modulo.filename = caminho;
modulo.paths = Module._nodeModulePaths(path.dirname(caminho));
modulo._compile(outputFiles[0].text, caminho);
const { consultarCatalogo, pecasCanonicas } = modulo.exports;

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const QUALIDADE = [
  { id: 1, linha: 'ED1 - ELETRO 1', tipo: 'PECA', item: 'PLACA PRINCIPAL (POWER)', ativo: true },
  { id: 2, linha: 'ED1 - ELETRO 1', tipo: 'DEFEITO', item: 'AMASSADO', ativo: true },
  { id: 3, linha: 'ED1 - ELETRO 1', tipo: 'ACESSORIO', item: 'MANUAL', ativo: true }
];
const resposta = (tabelas) => async (url) => {
  const tabela = new URL(url).pathname.split('/').pop();
  if (!(tabela in tabelas)) throw new Error('fora');
  const corpo = tabelas[tabela];
  if (corpo instanceof Error) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => corpo };
};
const comFetch = async (tabelas, fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = resposta(tabelas);
  try { return await fn(); } finally { globalThis.fetch = original; }
};

test('pecas vem do catalogo canonico por linha; so PECA ativa, em ordem alfabetica', () => {
  const r = pecasCanonicas(
    [{ codigo: 'A', nome_canonico: 'PORTA DO FREEZER', tipo: 'PECA' }, { codigo: 'B', nome_canonico: 'GABINETE', tipo: 'PECA' },
     { codigo: 'C', nome_canonico: 'MANUAL', tipo: 'ACESSORIO' }, { codigo: 'D', nome_canonico: 'VELHA', tipo: 'PECA', ativo: false }],
    [{ codigo: 'A', linha: 'ED1 - ELETRO 1' }, { codigo: 'B', linha: 'ED1 - ELETRO 1' }, { codigo: 'C', linha: 'ED1 - ELETRO 1' }, { codigo: 'D', linha: 'ED1 - ELETRO 1' }]
  );
  assert.deepEqual(r.map((x) => x.item), ['GABINETE', 'PORTA DO FREEZER']);
});

test('troca as pecas antigas pelas canonicas e mantem defeito/acessorio do catalogo_qualidade', async () => {
  const res = await comFetch({
    catalogo_qualidade: QUALIDADE,
    item_padrao: [{ codigo: 'PEC1', nome_canonico: 'PLACA PRINCIPAL', tipo: 'PECA', ativo: true }],
    item_padrao_linha: [{ codigo: 'PEC1', linha: 'ED1 - ELETRO 1' }]
  }, () => consultarCatalogo(ENV));
  const corpo = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(corpo.filter((r) => r.tipo === 'PECA').map((r) => r.item), ['PLACA PRINCIPAL']);
  assert.ok(corpo.some((r) => r.tipo === 'DEFEITO' && r.item === 'AMASSADO'));
  assert.ok(corpo.some((r) => r.tipo === 'ACESSORIO' && r.item === 'MANUAL'));
});

test('se o catalogo canonico falhar, cai nas pecas antigas (tela nao fica sem peca)', async () => {
  const res = await comFetch({ catalogo_qualidade: QUALIDADE, item_padrao: new Error('x'), item_padrao_linha: [] }, () => consultarCatalogo(ENV));
  const corpo = JSON.parse(res.body);
  assert.deepEqual(corpo.filter((r) => r.tipo === 'PECA').map((r) => r.item), ['PLACA PRINCIPAL (POWER)']);
});
