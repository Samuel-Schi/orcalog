import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['netlify/functions/_lote-envio.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const compiled=new Module(path.resolve('netlify/functions/lote-envio.test.cjs'));
compiled._compile(outputFiles[0].text,compiled.id);
const {idsDoLote}=compiled.exports;
test('confere todas as páginas e isola o protocolo',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('get_orcamentos_analise') ? {items:[{id:4,protocolo:'L1'}],hasMore:false} : ++calls===1 ? {items:[{id:1,protocolo:'L1'},{id:2,protocolo:'L2'}],hasMore:true} : {items:[{id:3,protocolo:'L1'}],hasMore:false}));
    assert.deepEqual(await idsDoLote('12345678000199','L1'),['1','3','4']);
    assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
test('página repetida e falha do Oracle não liberam lote',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({items:[{id:1,protocolo:'L1'}],hasMore:true}));
    await assert.rejects(idsDoLote('12345678000199','L1'),/repetida/);
    globalThis.fetch=async()=>new Response('erro',{status:503});
    await assert.rejects(idsDoLote('12345678000199','L1'),/conferir/);
  }finally{globalThis.fetch=original;}
});
