import type { Handler } from '@netlify/functions';
import { createSign } from 'crypto';
import { handleFunctionError, jsonResponse, methodNotAllowed, parseJsonBody, trimText } from './_shared.js';

type DriveUploadFile = {
  name?: string;
  mimeType?: string;
  base64?: string;
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const MAX_UPLOAD_BODY_BYTES = 5_500_000;
const GOOGLE_SERVICE_ACCOUNT_JSON_ENV = 'GOOGLE_SERVICE_ACCOUNT_JSON_ENVIO';

type GoogleServiceAccount = {
  client_email?: string;
  private_key?: string;
  google_drive_parent_folder_id?: string;
  drive_parent_folder_id?: string;
};

const base64Url = (input: string | Buffer) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const sanitizeDriveName = (value: unknown, fallback: string, keepExtension = false) => {
  const cleaned = trimText(value, 140)
    .replace(/[^a-zA-Z0-9_. -]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return (keepExtension ? cleaned : cleaned.replace(/\.[^/.]+$/g, '')) || fallback;
};

type UploadEnv = Record<string, string | undefined>;
const getServiceAccount = (env: UploadEnv): GoogleServiceAccount => {
  const rawJson = env[GOOGLE_SERVICE_ACCOUNT_JSON_ENV]?.trim();
  if (!rawJson) return {};

  try {
    const parsed = JSON.parse(rawJson) as GoogleServiceAccount;
    if (!parsed || typeof parsed !== 'object') throw new Error('Formato invalido.');
    return parsed;
  } catch {
    throw new Error(`Variavel ${GOOGLE_SERVICE_ACCOUNT_JSON_ENV} contem um JSON invalido.`);
  }
};

const getGoogleDriveConfig = (env: UploadEnv) => {
  const serviceAccount = getServiceAccount(env);
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL || serviceAccount.client_email;
  const privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || serviceAccount.private_key;
  const parentFolderId = env.GOOGLE_DRIVE_PARENT_FOLDER_ID
    || serviceAccount.google_drive_parent_folder_id
    || serviceAccount.drive_parent_folder_id;

  if (!email) throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_EMAIL ou o client_email no JSON da service account.');
  if (!privateKey) throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ou o private_key no JSON da service account.');
  if (!parentFolderId) throw new Error('Variavel GOOGLE_DRIVE_PARENT_FOLDER_ID nao configurada.');

  return { email, privateKey, parentFolderId };
};

const getGoogleAccessToken = async (env: UploadEnv) => {
  const { email: serviceAccountEmail, privateKey: configuredPrivateKey } = getGoogleDriveConfig(env);
  const privateKey = configuredPrivateKey.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccountEmail,
    scope: DRIVE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsignedToken).sign(privateKey);
  const assertion = `${unsignedToken}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Nao foi possivel autenticar no Google Drive.');
  }

  return String(data.access_token);
};

// Erro do Drive com a operacao, o ID envolvido e a service account: "File not found" sozinho nao diz nada.
const erroDrive = (operacao: string, id: string, response: Response, data: { error?: { message?: string } }, env: UploadEnv) => {
  let conta = '';
  try { conta = getGoogleDriveConfig(env).email; } catch { /* sem config: o erro original ja diz */ }
  const detalhe = data.error?.message || `HTTP ${response.status}`;
  const dica = response.status === 404
    ? ` Confira se o ID existe e se a service account ${conta || '(sem e-mail)'} e membro do Shared Drive (Gerente de conteudo ou Colaborador).`
    : '';
  console.error('[upload-foto-drive]', JSON.stringify({ operacao, id, status: response.status, detalhe, conta }));
  return new Error(`Google Drive: falha ao ${operacao} (ID ${id}): ${detalhe}.${dica}`);
};

const criarPastaDrive = async (token: string, folderName: string, env: UploadEnv) => {
  const { parentFolderId } = getGoogleDriveConfig(env);
  const response = await fetch(`${DRIVE_FILES_URL}?supportsAllDrives=true&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw erroDrive('criar pasta dentro da pasta raiz (GOOGLE_DRIVE_PARENT_FOLDER_ID)', parentFolderId, response, data, env);
  }

  return {
    id: String(data.id),
    link: String(data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`)
  };
};

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/;

// Reaproveita somente pastas criadas pelo portal, dentro da pasta raiz configurada.
const buscarPastaExistente = async (token: string, folderId: string, env: UploadEnv) => {
  if (!DRIVE_ID_PATTERN.test(folderId)) return null;
  const { parentFolderId } = getGoogleDriveConfig(env);
  const response = await fetch(
    `${DRIVE_FILES_URL}/${folderId}?supportsAllDrives=true&fields=id,mimeType,parents,trashed,webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Nao bloqueia: cai para criar uma pasta nova, mas deixa rastro no log.
    console.warn('[upload-foto-drive]', JSON.stringify({ operacao: 'reaproveitar pasta', id: folderId, status: response.status, detalhe: data.error?.message }));
    return null;
  }
  const parents = Array.isArray(data.parents) ? data.parents.map(String) : [];
  if (data.mimeType !== DRIVE_FOLDER_MIME || data.trashed || !parents.includes(parentFolderId)) {
    console.warn('[upload-foto-drive]', JSON.stringify({ operacao: 'reaproveitar pasta', id: folderId, motivo: 'nao e pasta do portal dentro da raiz', parents }));
    return null;
  }
  return {
    id: String(data.id),
    link: String(data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`)
  };
};

// Pasta unica por protocolo: procura dentro da raiz uma pasta com exatamente esse nome.
const buscarPastaPorNome = async (token: string, folderName: string, env: UploadEnv) => {
  const { parentFolderId } = getGoogleDriveConfig(env);
  const nome = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${parentFolderId}' in parents and name = '${nome}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    orderBy: 'createdTime',
    pageSize: '1',
    fields: 'files(id,webViewLink)'
  });
  const response = await fetch(`${DRIVE_FILES_URL}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw erroDrive(`procurar a pasta "${folderName}" dentro da pasta raiz`, parentFolderId, response, data, env);
  const pasta = Array.isArray(data.files) ? data.files[0] : null;
  return pasta?.id
    ? { id: String(pasta.id), link: String(pasta.webViewLink || `https://drive.google.com/drive/folders/${pasta.id}`) }
    : null;
};

const compartilharComQualquerUm = async (token: string, folderId: string) => {
  try {
    const response = await fetch(`${DRIVE_FILES_URL}/${folderId}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ type: 'anyone', role: 'reader' })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.warn('[upload-foto-drive]', JSON.stringify({ operacao: 'compartilhar pasta (anyone/reader)', id: folderId, status: response.status, detalhe: data.error?.message }));
    }
    return response.ok;
  } catch {
    return false;
  }
};

const uploadArquivoDrive = async (
  token: string,
  folderId: string,
  file: Required<DriveUploadFile>,
  index: number,
  env: UploadEnv
) => {
  const boundary = `portal_at_${Date.now()}_${index}`;
  const safeName = sanitizeDriveName(file.name, `foto_${index + 1}`, true);
  const mimeType = file.mimeType || 'application/octet-stream';
  const media = Buffer.from(file.base64, 'base64');
  if (media.length === 0) throw new Error(`O arquivo ${safeName} esta vazio.`);
  const metadata = {
    name: safeName,
    parents: [folderId]
  };

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    media,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const response = await fetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    throw erroDrive(`enviar o arquivo ${safeName} para a pasta`, folderId, response, data, env);
  }

  return {
    id: String(data.id),
    name: String(data.name || safeName),
    link: String(data.webViewLink || '')
  };
};

// --- Video em partes (upload resumable do Drive) ---
// O Netlify aceita ~6 MB por chamada; o video vai em partes de ate 3 MB pela mesma funcao.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const PARTE_VIDEO_MULTIPLO = 256 * 1024;

type VideoBody = {
  acao?: string; folderName?: string; folderId?: string; reusarPorNome?: boolean; name?: string; mimeType?: string; tamanho?: number;
  sessao?: string; inicio?: number; total?: number; base64?: string;
};

const sessaoValida = (valor: unknown) => {
  try {
    const url = new URL(String(valor || ''));
    // So aceita a URL de sessao do proprio Drive (evita usar a funcao como proxy para outro endereco).
    return url.protocol === 'https:' && url.hostname === 'www.googleapis.com'
      && url.pathname === '/upload/drive/v3/files' && Boolean(url.searchParams.get('upload_id')) ? url.toString() : '';
  } catch {
    return '';
  }
};

const iniciarVideo = async (env: UploadEnv, body: VideoBody) => {
  const mimeType = trimText(body.mimeType, 120);
  const tamanho = Number(body.tamanho);
  if (!mimeType.startsWith('video/')) return jsonResponse(400, { error: 'Envie apenas arquivos de video.' });
  if (!Number.isInteger(tamanho) || tamanho <= 0) return jsonResponse(400, { error: 'Tamanho do video invalido.' });
  if (tamanho > MAX_VIDEO_BYTES) return jsonResponse(413, { error: `Video maior que ${MAX_VIDEO_BYTES / 1024 / 1024} MB.` });

  const token = await getGoogleAccessToken(env);
  const nomePasta = sanitizeDriveName(body.folderName, `Portal_AT_${Date.now()}`);
  const existente = (body.folderId ? await buscarPastaExistente(token, String(body.folderId).trim(), env) : null)
    || (body.reusarPorNome === true ? await buscarPastaPorNome(token, nomePasta, env) : null);
  const folder = existente || await criarPastaDrive(token, nomePasta, env);
  const response = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(tamanho)
    },
    body: JSON.stringify({ name: sanitizeDriveName(body.name, 'video', true), parents: [folder.id] })
  });
  const sessao = sessaoValida(response.headers.get('location'));
  if (!response.ok || !sessao) {
    const data = await response.json().catch(() => ({}));
    throw erroDrive('iniciar o envio do video na pasta', folder.id, response, data, env);
  }
  return jsonResponse(200, { folderId: folder.id, folderLink: folder.link, folderReused: Boolean(existente), sessao });
};

const enviarParteVideo = async (body: VideoBody) => {
  const sessao = sessaoValida(body.sessao);
  const inicio = Number(body.inicio);
  const total = Number(body.total);
  const parte = Buffer.from(String(body.base64 || ''), 'base64');
  if (!sessao) return jsonResponse(400, { error: 'Sessao de envio do video invalida.' });
  if (!Number.isInteger(inicio) || !Number.isInteger(total) || inicio < 0 || total <= 0 || total > MAX_VIDEO_BYTES || !parte.length) {
    return jsonResponse(400, { error: 'Parte do video invalida.' });
  }
  const fim = inicio + parte.length - 1;
  if (fim >= total || (fim < total - 1 && parte.length % PARTE_VIDEO_MULTIPLO !== 0)) {
    return jsonResponse(400, { error: 'Parte do video fora do tamanho esperado.' });
  }
  const response = await fetch(sessao, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes ${inicio}-${fim}/${total}` },
    body: parte
  });
  if (response.status === 308) {
    const recebido = /bytes=0-(\d+)/.exec(response.headers.get('range') || '');
    return jsonResponse(200, { concluido: false, recebido: recebido ? Number(recebido[1]) + 1 : 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(data.error?.message || 'O Drive nao confirmou a parte do video.');
  return jsonResponse(200, { concluido: true, file: { id: String(data.id), name: String(data.name || ''), link: String(data.webViewLink || '') } });
};

export const createUploadHandler = (env: UploadEnv): Handler => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const parsedBody = parseJsonBody(event, MAX_UPLOAD_BODY_BYTES);
    if (!parsedBody.ok) return parsedBody.response;

    const acao = (parsedBody.value as VideoBody)?.acao;
    if (acao === 'iniciar_video') return await iniciarVideo(env, parsedBody.value as VideoBody);
    if (acao === 'parte_video') return await enviarParteVideo(parsedBody.value as VideoBody);

    const body = parsedBody.value as { folderName?: string; folderId?: string; reusarPorNome?: boolean; publicFolder?: boolean; files?: DriveUploadFile[] };
    const files = Array.isArray(body.files) ? body.files : [];
    const validFiles = files
      .map((file) => ({
        name: trimText(file.name, 160),
        mimeType: trimText(file.mimeType || 'application/octet-stream', 120),
        base64: String(file.base64 || '').trim()
      }))
      .filter((file): file is Required<DriveUploadFile> => Boolean(file.base64));

    if (validFiles.length === 0) {
      return jsonResponse(400, { error: 'Selecione pelo menos um arquivo para enviar.' });
    }

    const folderName = sanitizeDriveName(body.folderName, `Portal_AT_${Date.now()}`);
    const token = await getGoogleAccessToken(env);
    const existente = (body.folderId ? await buscarPastaExistente(token, String(body.folderId).trim(), env) : null)
      || (body.reusarPorNome === true ? await buscarPastaPorNome(token, folderName, env) : null);
    const folder = existente || await criarPastaDrive(token, folderName, env);
    const folderPublic = body.publicFolder === true ? await compartilharComQualquerUm(token, folder.id) : false;
    const uploadedFiles = await Promise.all(
      validFiles.map((file, index) => uploadArquivoDrive(token, folder.id, file, index, env))
    );

    return jsonResponse(200, {
      folderId: folder.id,
      folderLink: folder.link,
      folderReused: Boolean(existente),
      folderPublic,
      files: uploadedFiles
    });
  } catch (error) {
    return handleFunctionError(error);
  }
};

export const handler = createUploadHandler(process.env);
