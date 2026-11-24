import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const compilar = async (entrada, nome) => {
  const { outputFiles } = await build({ entryPoints: [entrada], bundle: true, platform: 'node', format: 'cjs', write: false });
  const caminho = path.resolve(nome);
  const modulo = new Module(caminho);
  modulo.filename = caminho;
  modulo.paths = Module._nodeModulePaths(path.dirname(caminho));
  modulo._compile(outputFiles[0].text, caminho);
  return modulo.exports;
};
const lib = await compilar('src/lib/evidenciasDrive.ts', 'src/lib/evidencias-drive.test.cjs');
const importacao = await compilar('src/lib/importacaoOrcamento.ts', 'src/lib/importacao-evidencias.test.cjs');
const funcao = await compilar('netlify/functions/upload-foto-drive.ts', 'netlify/functions/upload-video.test.cjs');

const arquivo = (nome, tipo, bytes, lastModified = 1) => new File([new Uint8Array(bytes)], nome, { type: tipo, lastModified });
const MB = 1024 * 1024;

test('fotos vao juntas na pasta do produto e o video vai em partes de 3 MB na mesma pasta', async () => {
  const chamadas = [];
  const postar = async (body) => {
    chamadas.push(body);
    if (body.files) return { folderId: 'pasta1', folderLink: 'https://drive.google.com/drive/folders/pasta1', files: body.files.map((_, i) => ({ id: `f${i}` })) };
    if (body.acao === 'iniciar_video') return { folderId: 'pasta1', folderLink: 'https://drive.google.com/drive/folders/pasta1', sessao: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc' };
    const ultima = body.inicio + Buffer.from(body.base64, 'base64').length >= body.total;
    return ultima ? { concluido: true, file: { id: 'video1' } } : { concluido: false };
  };
  const progresso = [];
  const link = await lib.enviarEvidenciasDrive(
    [arquivo('a.jpg', 'image/jpeg', 10), arquivo('b.png', 'image/png', 20), arquivo('avaria.mp4', 'video/mp4', 7 * MB)],
    'Portal_AT_P1_10_S1_20261112', (enviados, total) => progresso.push(`${enviados}/${total}`), postar
  );
  assert.equal(link, 'https://drive.google.com/drive/folders/pasta1');
  assert.equal(chamadas[0].folderName, 'Portal_AT_P1_10_S1_20261112');
  assert.equal(chamadas[0].files.length, 2);
  assert.equal(chamadas[1].acao, 'iniciar_video');
  assert.equal(chamadas[1].folderId, 'pasta1');
  assert.equal(chamadas[1].tamanho, 7 * MB);
  const partes = chamadas.filter((c) => c.acao === 'parte_video');
  assert.deepEqual(partes.map((p) => [p.inicio, Buffer.from(p.base64, 'base64').length]), [[0, 3 * MB], [3 * MB, 3 * MB], [6 * MB, MB]]);
  assert.deepEqual(progresso, ['2/3', '3/3']);
});

test('nao confirma evidencia sem resposta do Drive', async () => {
  await assert.rejects(lib.enviarEvidenciasDrive([arquivo('a.jpg', 'image/jpeg', 10)], 'P', undefined, async () => ({ folderId: 'x', folderLink: 'y', files: [] })), /não confirmou/);
  await assert.rejects(lib.enviarEvidenciasDrive([arquivo('v.mp4', 'video/mp4', 10)], 'P', undefined, async (b) =>
    b.acao === 'iniciar_video' ? { folderId: 'x', folderLink: 'y', sessao: 's' } : { concluido: false }), /não confirmou o vídeo/);
});

test('timeout ou queda de rede: tenta de novo; erro de dados (4xx) nao repete', async () => {
  let chamadas = 0;
  const instavel = async (body) => {
    chamadas += 1;
    if (chamadas === 1) throw Object.assign(new Error('timeout of 55000ms exceeded'), { code: 'ECONNABORTED' });
    if (chamadas === 2) throw Object.assign(new Error('Bad gateway'), { response: { status: 502 } });
    return { folderId: 'p', folderLink: 'l', files: body.files.map((_, i) => ({ id: `f${i}` })) };
  };
  assert.equal(await lib.enviarEvidenciasDrive([arquivo('a.jpg', 'image/jpeg', 10)], 'P', undefined, instavel, [0, 0]), 'l');
  assert.equal(chamadas, 3);

  let tentativas = 0;
  await assert.rejects(lib.enviarEvidenciasDrive([arquivo('a.jpg', 'image/jpeg', 10)], 'P', undefined, async () => {
    tentativas += 1; throw Object.assign(new Error('invalido'), { response: { status: 400 } });
  }, [0, 0]), /invalido/);
  assert.equal(tentativas, 1);
});

test('fotos vao em grupos pequenos para nao estourar o tempo da Function', async () => {
  const grupos = [];
  await lib.enviarEvidenciasDrive([0, 1, 2].map((i) => arquivo(`f${i}.jpg`, 'image/jpeg', 700_000, i)), 'P', undefined, async (body) => {
    grupos.push(body.files.length);
    return { folderId: 'p', folderLink: 'l', files: body.files.map((_, i) => ({ id: `f${i}` })) };
  });
  // 700 KB vira ~930 KB em base64: cabe uma foto por chamada no grupo de ~1,5 MB.
  assert.deepEqual(grupos, [1, 1, 1]);
});

test('PDF grande da nota vai em partes de 3 MB e devolve pasta e arquivo', async () => {
  const chamadas = [];
  const r = await lib.enviarArquivoEmPartes(arquivo('nf.pdf', 'application/pdf', 7 * MB), 'NF PRODUTO P1 nf.pdf', 'application/pdf', { folderName: 'Pagamento_P1', publicFolder: true }, async (body) => {
    chamadas.push(body);
    if (body.acao === 'iniciar_video') return { folderId: 'pasta', folderLink: 'link', sessao: 's' };
    return body.inicio + Buffer.from(body.base64, 'base64').length >= body.total ? { concluido: true, file: { id: 'pdf1' } } : { concluido: false };
  }, [0]);
  assert.deepEqual(r, { folderId: 'pasta', folderLink: 'link', fileId: 'pdf1' });
  assert.deepEqual([chamadas[0].mimeType, chamadas[0].name, chamadas[0].publicFolder], ['application/pdf', 'NF_PRODUTO_P1_nf.pdf', true]);
  assert.equal(chamadas.filter((c) => c.acao === 'parte_video').length, 3);
});

test('funcao: aceita PDF em partes ate 20 MB', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('nao deveria chamar a rede'); };
  try {
    assert.equal((await chamar(handler(), { acao: 'iniciar_video', mimeType: 'application/pdf', tamanho: 21 * MB })).statusCode, 413);
  } finally { globalThis.fetch = original; }
});

test('aceita so foto e video, sem repetir e dentro do limite', () => {
  const atual = arquivo('a.jpg', 'image/jpeg', 10);
  const { aceitos, avisos } = lib.filtrarEvidencias([atual], [
    arquivo('a.jpg', 'image/jpeg', 10), arquivo('nota.pdf', 'application/pdf', 10), arquivo('v.mp4', 'video/mp4', 10), arquivo('enorme.mov', 'video/quicktime', 101 * MB)
  ]);
  assert.deepEqual(aceitos.map((f) => f.name), ['v.mp4']);
  assert.equal(avisos.length, 2);
  assert.equal(lib.resumoEvidencias([atual, ...aceitos]), '1 foto · 1 vídeo');
  assert.equal(lib.nomePastaEvidencias('P1-10', '123', 'AB/1', new Date(2026, 10, 12, 9, 5, 7)), 'Portal_AT_P1-10_123_AB_1_20261112090507');
});

test('avaria com evidencia perde o aviso; sem evidencia o aviso volta', () => {
  const cab = ['Serial', 'Nota fiscal', 'Gemco ou Código de barras', 'Defeito encontrado', 'Defeito funcional (SIM/NAO)', 'Garantia (SIM/NAO)', 'Tipo Orc.', 'Peças (nome: valor; nome: valor)', 'Acessórios (nome: valor; nome: valor)', 'Mão de obra (R$)', 'Embalagem (R$)', 'Higienização (R$)'];
  const { itens: [item] } = importacao.interpretarPlanilhaOrcamento([cab, ['S1', 'NF', '10', 'AVARIA ESTETICA', 'SIM', 'NAO', 'NOVO', 'Tampa: 10', '', '', '', '']]);
  const temAviso = () => item.pendencias.some((p) => p.mensagem === importacao.AVISO_AVARIA_SEM_FOTO);
  assert.equal(temAviso(), true);
  importacao.definirEvidencias(item, [arquivo('a.jpg', 'image/jpeg', 10)]);
  assert.equal(temAviso(), false);
  importacao.definirEvidencias(item, []);
  assert.equal(temAviso(), true);
  assert.equal(item.pendencias.filter((p) => p.mensagem === importacao.AVISO_AVARIA_SEM_FOTO).length, 1);
});

const handler = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return funcao.createUploadHandler({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'local@example.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    GOOGLE_DRIVE_PARENT_FOLDER_ID: 'raiz'
  });
};
const chamar = (h, body) => h({ httpMethod: 'POST', body: JSON.stringify(body), isBase64Encoded: false });
const SESSAO = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=xyz';

test('funcao: inicia a sessao do video na pasta e repassa as partes ao Drive', async () => {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, init = {}) => {
    const alvo = String(url);
    chamadas.push({ alvo, init });
    if (alvo.includes('oauth2')) return Response.json({ access_token: 't' });
    if (alvo.includes('uploadType=resumable') && init.method === 'POST') {
      assert.equal(init.headers['X-Upload-Content-Type'], 'video/mp4');
      assert.equal(init.headers['X-Upload-Content-Length'], String(4 * MB));
      assert.deepEqual(JSON.parse(init.body).parents, ['pastaNova']);
      return new Response(null, { status: 200, headers: { location: SESSAO } });
    }
    if (alvo === SESSAO) {
      const range = init.headers['Content-Range'];
      return range.endsWith(`-${4 * MB - 1}/${4 * MB}`)
        ? Response.json({ id: 'video1', name: 'v.mp4' })
        : new Response(null, { status: 308, headers: { range: 'bytes=0-3145727' } });
    }
    return Response.json({ id: 'pastaNova' });
  };
  try {
    const h = handler();
    const inicio = JSON.parse((await chamar(h, { acao: 'iniciar_video', folderName: 'Portal_AT_P1', name: 'v.mp4', mimeType: 'video/mp4', tamanho: 4 * MB })).body);
    assert.equal(inicio.sessao, SESSAO);
    assert.equal(inicio.folderId, 'pastaNova');
    const p1 = JSON.parse((await chamar(h, { acao: 'parte_video', sessao: SESSAO, inicio: 0, total: 4 * MB, base64: Buffer.alloc(3 * MB).toString('base64') })).body);
    assert.deepEqual(p1, { concluido: false, recebido: 3 * MB });
    const p2 = JSON.parse((await chamar(h, { acao: 'parte_video', sessao: SESSAO, inicio: 3 * MB, total: 4 * MB, base64: Buffer.alloc(MB).toString('base64') })).body);
    assert.equal(p2.concluido, true);
    assert.equal(p2.file.id, 'video1');
  } finally { globalThis.fetch = original; }
});

test('funcao: recusa sessao de outro endereco, parte fora do tamanho e arquivo que nao e video', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('nao deveria chamar a rede'); };
  try {
    const h = handler();
    const base64 = Buffer.alloc(10).toString('base64');
    assert.equal((await chamar(h, { acao: 'parte_video', sessao: 'https://evil.example.com/upload/drive/v3/files?upload_id=1', inicio: 0, total: 10, base64 })).statusCode, 400);
    // Parte do meio precisa ser multiplo de 256 KB.
    assert.equal((await chamar(h, { acao: 'parte_video', sessao: SESSAO, inicio: 0, total: 100, base64 })).statusCode, 400);
    assert.equal((await chamar(h, { acao: 'iniciar_video', mimeType: 'application/zip', tamanho: 10 })).statusCode, 400);
    assert.equal((await chamar(h, { acao: 'iniciar_video', mimeType: 'video/mp4', tamanho: 101 * MB })).statusCode, 413);
  } finally { globalThis.fetch = original; }
});
