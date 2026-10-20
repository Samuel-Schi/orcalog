import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['netlify/functions/upload-foto-drive.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false
});
const modulePath = path.resolve('netlify/functions/upload-foto-drive.test.cjs');
const functionModule = new Module(modulePath);
functionModule.filename = modulePath;
functionModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
functionModule._compile(outputFiles[0].text, modulePath);
const { handler } = functionModule.exports;

test('envia PDF com a configuracao local e preserva bytes e tipo do documento', async () => {
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const localHandler = functionModule.exports.createUploadHandler({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'local@example.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    GOOGLE_DRIVE_PARENT_FOLDER_ID: 'local-parent'
  });
  const pdf = Buffer.from('%PDF-1.4\n%%EOF');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('oauth2.googleapis.com')) return Response.json({ access_token: 'local-token' });
    if (String(url).includes('upload/drive')) {
      assert.ok(init.body.includes(pdf));
      assert.ok(init.body.includes(Buffer.from('Content-Type: application/pdf')));
      assert.ok(init.body.includes(Buffer.from('"parents":["pdf-folder"]')));
      return Response.json({ id: 'pdf-id', name: 'nota.pdf' });
    }
    const metadata = JSON.parse(init.body);
    assert.deepEqual(metadata.parents, ['local-parent']);
    assert.equal(metadata.name, 'Pagamento_P1-10');
    return Response.json({ id: 'pdf-folder' });
  };
  try {
    const response = await localHandler({ httpMethod: 'POST', body: JSON.stringify({
      folderName: 'Pagamento_P1-10', files: [{ name: 'nota.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') }]
    }), isBase64Encoded: false });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).folderLink, 'https://drive.google.com/drive/folders/pdf-folder');
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

const comCredenciais = (parent = 'local-parent') => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return functionModule.exports.createUploadHandler({
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'local@example.com',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    GOOGLE_DRIVE_PARENT_FOLDER_ID: parent
  });
};
const pdfBody = (extra) => JSON.stringify({
  folderName: 'Pagamento_P1', files: [{ name: 'nota.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF').toString('base64') }], ...extra
});

test('reaproveita a pasta do protocolo e a deixa aberta para quem tiver o link', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push(`${init.method || 'GET'} ${target}`);
    if (target.includes('oauth2')) return Response.json({ access_token: 't' });
    if (target.includes('/permissions')) {
      assert.deepEqual(JSON.parse(init.body), { type: 'anyone', role: 'reader' });
      return Response.json({ id: 'anyoneWithLink' });
    }
    if (target.includes('upload/drive')) {
      assert.ok(init.body.includes(Buffer.from('"parents":["pastaExistente01"]')));
      return Response.json({ id: 'arquivo-2' });
    }
    if (target.includes('/files/pastaExistente01?')) {
      return Response.json({ id: 'pastaExistente01', mimeType: 'application/vnd.google-apps.folder', parents: ['local-parent'] });
    }
    throw new Error('Não deveria criar nova pasta: ' + target);
  };
  try {
    const response = await comCredenciais()({ httpMethod: 'POST', body: pdfBody({ folderId: 'pastaExistente01', publicFolder: true }) });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.folderId, 'pastaExistente01');
    assert.equal(body.folderReused, true);
    assert.equal(body.folderPublic, true);
    assert.ok(calls.some((c) => c.includes('/permissions')));
  } finally { globalThis.fetch = originalFetch; }
});

test('cria nova pasta quando o folderId informado não pertence à pasta raiz', async () => {
  const originalFetch = globalThis.fetch;
  let criou = false;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('oauth2')) return Response.json({ access_token: 't' });
    if (target.includes('/files/pastaDeOutroLugar?')) {
      return Response.json({ id: 'pastaDeOutroLugar', mimeType: 'application/vnd.google-apps.folder', parents: ['outra-raiz'] });
    }
    if (target.includes('upload/drive')) {
      assert.ok(init.body.includes(Buffer.from('"parents":["nova-pasta"]')));
      return Response.json({ id: 'arquivo-1' });
    }
    criou = true;
    assert.deepEqual(JSON.parse(init.body).parents, ['local-parent']);
    return Response.json({ id: 'nova-pasta' });
  };
  try {
    const response = await comCredenciais()({ httpMethod: 'POST', body: pdfBody({ folderId: 'pastaDeOutroLugar' }) });
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).folderId, 'nova-pasta');
    assert.equal(JSON.parse(response.body).folderReused, false);
    assert.equal(criou, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('envia os bytes da foto ao Drive e devolve o link da pasta', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_DRIVE_PARENT_FOLDER_ID: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO
  };
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID = 'parent';

  const photo = Buffer.from([0xff, 0xd8, 0x00, 0x45, 0xff, 0xd9]);
  let uploaded = false;
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'test-token' });
    }
    if (target.includes('upload/drive/v3/files')) {
      assert.equal(init.method, 'POST');
      assert.match(init.headers['Content-Type'], /^multipart\/related; boundary=/);
      assert.ok(Buffer.isBuffer(init.body));
      assert.ok(init.body.includes(photo));
      assert.ok(init.body.includes(Buffer.from('Foto_Avaria_123.jpg')));
      assert.ok(!init.body.includes(Buffer.from('Content-Transfer-Encoding: base64')));
      uploaded = true;
      return Response.json({ id: 'photo-1', name: 'Foto_Avaria_123.jpg' });
    }
    return Response.json({ id: 'folder-1', webViewLink: 'https://drive.google.com/drive/folders/folder-1' });
  };

  try {
    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        folderName: 'Orcamento_123',
        files: [{ name: 'Foto_Avaria_123.jpg', mimeType: 'image/jpeg', base64: photo.toString('base64') }]
      })
    });
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).folderLink, 'https://drive.google.com/drive/folders/folder-1');
    assert.equal(uploaded, true);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('aceita as credenciais no JSON configurado na Netlify', async () => {
  const originalEnv = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_DRIVE_PARENT_FOLDER_ID: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO
  };
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID = 'parent';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO = JSON.stringify({
    client_email: 'json-test@example.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'test-token' });
    return Response.json({ id: 'folder-1', webViewLink: 'https://drive.google.com/drive/folders/folder-1' });
  };

  try {
    const result = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        files: [{ name: 'Foto.jpg', mimeType: 'image/jpeg', base64: Buffer.from('foto').toString('base64') }]
      })
    });
    assert.equal(result.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
