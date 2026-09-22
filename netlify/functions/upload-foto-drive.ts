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

const getServiceAccount = (): GoogleServiceAccount => {
  const rawJson = process.env[GOOGLE_SERVICE_ACCOUNT_JSON_ENV]?.trim();
  if (!rawJson) return {};

  try {
    const parsed = JSON.parse(rawJson) as GoogleServiceAccount;
    if (!parsed || typeof parsed !== 'object') throw new Error('Formato invalido.');
    return parsed;
  } catch {
    throw new Error(`Variavel ${GOOGLE_SERVICE_ACCOUNT_JSON_ENV} contem um JSON invalido.`);
  }
};

const getGoogleDriveConfig = () => {
  const serviceAccount = getServiceAccount();
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || serviceAccount.client_email;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || serviceAccount.private_key;
  const parentFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
    || serviceAccount.google_drive_parent_folder_id
    || serviceAccount.drive_parent_folder_id;

  if (!email) throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_EMAIL ou o client_email no JSON da service account.');
  if (!privateKey) throw new Error('Configure GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ou o private_key no JSON da service account.');
  if (!parentFolderId) throw new Error('Variavel GOOGLE_DRIVE_PARENT_FOLDER_ID nao configurada.');

  return { email, privateKey, parentFolderId };
};

const getGoogleAccessToken = async () => {
  const { email: serviceAccountEmail, privateKey: configuredPrivateKey } = getGoogleDriveConfig();
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

const criarPastaDrive = async (token: string, folderName: string) => {
  const { parentFolderId } = getGoogleDriveConfig();
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
    throw new Error(data.error?.message || 'Nao foi possivel criar a pasta no Drive.');
  }

  return {
    id: String(data.id),
    link: String(data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`)
  };
};

const uploadArquivoDrive = async (
  token: string,
  folderId: string,
  file: Required<DriveUploadFile>,
  index: number
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
    throw new Error(data.error?.message || `Nao foi possivel enviar o arquivo ${safeName}.`);
  }

  return {
    id: String(data.id),
    name: String(data.name || safeName),
    link: String(data.webViewLink || '')
  };
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const parsedBody = parseJsonBody(event, MAX_UPLOAD_BODY_BYTES);
    if (!parsedBody.ok) return parsedBody.response;

    const body = parsedBody.value as { folderName?: string; files?: DriveUploadFile[] };
    const files = Array.isArray(body.files) ? body.files : [];
    const validFiles = files
      .map((file) => ({
        name: trimText(file.name, 160),
        mimeType: trimText(file.mimeType || 'application/octet-stream', 120),
        base64: String(file.base64 || '').trim()
      }))
      .filter((file): file is Required<DriveUploadFile> => Boolean(file.base64));

    if (validFiles.length === 0) {
      return jsonResponse(400, { error: 'Envie pelo menos uma foto para upload.' });
    }

    const folderName = sanitizeDriveName(body.folderName, `Portal_AT_${Date.now()}`);
    const token = await getGoogleAccessToken();
    const folder = await criarPastaDrive(token, folderName);
    const uploadedFiles = await Promise.all(
      validFiles.map((file, index) => uploadArquivoDrive(token, folder.id, file, index))
    );

    return jsonResponse(200, {
      folderId: folder.id,
      folderLink: folder.link,
      files: uploadedFiles
    });
  } catch (error) {
    return handleFunctionError(error);
  }
};
