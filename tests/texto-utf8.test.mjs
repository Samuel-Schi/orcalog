import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const carregar = async (entrada) => {
  const { outputFiles } = await build({ entryPoints: [entrada], bundle: true, platform: 'node', format: 'cjs', write: false });
  const compilado = new Module(path.resolve(`${entrada}.test.cjs`));
  compilado._compile(outputFiles[0].text, compilado.id);
  return compilado.exports;
};
const { corrigirTextoQuebrado, corrigirTextosQuebrados, decodificarBytes } = await carregar('src/lib/texto.ts');
const { proxyResponse } = await carregar('netlify/functions/_shared.ts');

// Simula o defeito: texto UTF-8 lido como Windows-1252.
const quebrar = (texto) => new TextDecoder('windows-1252').decode(new TextEncoder().encode(texto));

test('repara acentuacao quebrada, inclusive maiusculas que caem em 0x80-0x9F', () => {
  for (const original of ['Aço inoxidável', 'MANUTENÇÃO ELÉTRICA', 'Não liga — fonte queimada', 'Proteção 10°C', 'ÍNDIA Ü Ó']) {
    assert.equal(corrigirTextoQuebrado(quebrar(original)), original);
  }
});

test('texto correto ou sem acento continua igual', () => {
  for (const texto of ['Aço', 'CAIXA PORTA TRECOS', 'SALVAR EDIÇÃO', 'São Paulo', '', 'Ã']) {
    assert.equal(corrigirTextoQuebrado(texto), texto);
  }
});

test('repara todas as strings de um JSON sem mexer em numeros e nulos', () => {
  const entrada = { items: [{ descricao: quebrar('Fogão'), total: 10, obs: null, tags: [quebrar('Peça')] }] };
  assert.deepEqual(corrigirTextosQuebrados(entrada), { items: [{ descricao: 'Fogão', total: 10, obs: null, tags: ['Peça'] }] });
});

test('decodifica UTF-8 e cai para Windows-1252 quando os bytes nao sao UTF-8', () => {
  assert.equal(decodificarBytes(new TextEncoder().encode('Ação')), 'Ação');
  assert.equal(decodificarBytes(Uint8Array.from([0x41, 0xE7, 0xE3, 0x6F])), 'Ação');
});

test('proxy do Oracle devolve UTF-8 mesmo quando a origem manda Windows-1252', async () => {
  const latin1 = Uint8Array.from([...Buffer.from('{"descricao":"Fog'), 0xE3, ...Buffer.from('o"}')]);
  const resposta = await proxyResponse(new Response(latin1, { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.equal(JSON.parse(resposta.body).descricao, 'Fogão');
  assert.equal(resposta.headers['Content-Type'], 'application/json; charset=utf-8');
  const utf8 = await proxyResponse(new Response('{"descricao":"Fogão"}', { headers: { 'content-type': 'application/json' } }));
  assert.equal(JSON.parse(utf8.body).descricao, 'Fogão');
});
