import { oracleApi, ORACLE_ENDPOINTS } from './oracle';

/*
 * Evidencias (fotos e videos) anexadas na conferencia do recebimento.
 * Vao para o Google Drive pela mesma Function de hoje (/upload_foto_drive), numa pasta por produto
 * com o mesmo nome usado em Lancar Orcamentos: Portal_AT_<protocolo>_<gemco>_<serial>_<data>.
 * Fotos vao em grupos de ate ~4 MB; video vai em partes de 3 MB (o Netlify aceita ~6 MB por chamada).
 */

export const MAX_ARQUIVOS_EVIDENCIA = 20;
export const MAX_VIDEO_MB = 100;
// Grupos menores (~1,5 MB) para cada chamada terminar bem antes do limite de tempo da Function (10 s no Netlify):
// com internet lenta no posto, grupos de 4 MB estouravam o tempo e a foto "não subia".
const MAX_LOTE_FOTOS_BASE64 = 1_500_000;
// Foto sozinha pode passar do grupo (até o limite do corpo da Function).
const MAX_FOTO_BASE64 = 4_000_000;
const ESPERAS_NOVA_TENTATIVA_MS = [1500, 4000];
// Multiplo de 256 KB, exigido pelo Drive em todas as partes menos a ultima.
export const PARTE_VIDEO_BYTES = 3 * 1024 * 1024;

export const tipoEvidencia = (file: Pick<File, 'type'>) =>
  file.type.startsWith('image/') ? 'foto' : file.type.startsWith('video/') ? 'video' : null;

/** Separa os arquivos aceitos e explica o que ficou de fora. */
export const filtrarEvidencias = (atuais: File[], novos: File[]) => {
  const chave = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
  const existentes = new Set(atuais.map(chave));
  const avisos: string[] = [];
  const aceitos: File[] = [];
  for (const file of novos) {
    if (!tipoEvidencia(file)) { avisos.push(`${file.name}: envie apenas foto ou vídeo.`); continue; }
    if (tipoEvidencia(file) === 'video' && file.size > MAX_VIDEO_MB * 1024 * 1024) { avisos.push(`${file.name}: vídeo maior que ${MAX_VIDEO_MB} MB.`); continue; }
    if (existentes.has(chave(file))) continue;
    if (atuais.length + aceitos.length >= MAX_ARQUIVOS_EVIDENCIA) { avisos.push(`Limite de ${MAX_ARQUIVOS_EVIDENCIA} arquivos por produto.`); break; }
    existentes.add(chave(file));
    aceitos.push(file);
  }
  return { aceitos, avisos };
};

export const resumoEvidencias = (arquivos: File[]) => {
  const fotos = arquivos.filter((f) => tipoEvidencia(f) === 'foto').length;
  const videos = arquivos.length - fotos;
  return [fotos && `${fotos} foto${fotos === 1 ? '' : 's'}`, videos && `${videos} vídeo${videos === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
};

const token = (valor: string, padrao: string) =>
  String(valor || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || padrao;

export const nomePastaEvidencias = (protocolo: string, gemco: string, serial: string, data = new Date()) => {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const carimbo = `${data.getFullYear()}${p2(data.getMonth() + 1)}${p2(data.getDate())}${p2(data.getHours())}${p2(data.getMinutes())}${p2(data.getSeconds())}`;
  return ['Portal_AT', token(protocolo, 'SEM_PROTOCOLO'), token(gemco, 'SEM_GEMCO'), token(serial, 'SEM_SERIAL'), carimbo].join('_');
};

/** Pasta unica do protocolo: todas as fotos e videos do lote vao para ela (o servidor reaproveita pelo nome). */
export const nomePastaProtocolo = (protocolo: string) => `Portal_AT_${token(protocolo, 'SEM_PROTOCOLO')}`;

/** Prefixo dos arquivos dentro da pasta do protocolo: identifica o produto de cada foto. */
export const prefixoArquivoProduto = (serial: string, gemco: string) =>
  `${token(serial, 'SEM_SERIAL')}_${token(gemco, 'SEM_GEMCO')}`;

type PastaDestino = string | { nome: string; prefixoArquivo?: string };

const paraBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
};

// Foto grande e reduzida para 1600 px em JPEG, como em Lancar Orcamentos.
const prepararFoto = async (file: File): Promise<{ blob: Blob; nome: string }> => {
  if (file.size <= 1_500_000 || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return { blob: file, nome: file.name };
  try {
    const imagem = await createImageBitmap(file);
    const escala = Math.min(1, 1600 / Math.max(imagem.width, imagem.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imagem.width * escala));
    canvas.height = Math.max(1, Math.round(imagem.height * escala));
    canvas.getContext('2d')?.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    imagem.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return blob ? { blob, nome: `${file.name.replace(/\.[^.]+$/, '')}.jpg` } : { blob: file, nome: file.name };
  } catch {
    return { blob: file, nome: file.name };
  }
};

type Postar = (body: Record<string, unknown>) => Promise<any>;
const postarPadrao: Postar = async (body) =>
  (await oracleApi.post(ORACLE_ENDPOINTS.uploadFotoDrive, body, { headers: { 'Content-Type': 'application/json' }, timeout: 55000 })).data;

// Timeout, queda de rede e erro 5xx/429 são passageiros: tenta de novo. Erro de dados (4xx) não adianta repetir.
export const erroPassageiro = (error: any) => {
  const status = Number(error?.response?.status);
  if (!status) return true;
  return status === 408 || status === 429 || status >= 500;
};
const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const comNovaTentativa = async <T>(acao: () => Promise<T>, esperas: number[] = ESPERAS_NOVA_TENTATIVA_MS): Promise<T> => {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await acao();
    } catch (error) {
      if (tentativa >= esperas.length || !erroPassageiro(error)) throw error;
      await esperar(esperas[tentativa]);
    }
  }
};

/**
 * Envia um arquivo grande (vídeo ou PDF de nota) em partes de 3 MB pela sessão resumable do Drive.
 * Cada chamada fica pequena: não esbarra no limite de corpo (~6 MB) nem de tempo da Function.
 */
export const enviarArquivoEmPartes = async (
  file: Blob, nome: string, mimeType: string, destino: Record<string, unknown>,
  postarUmaVez: Postar = postarPadrao, esperas: number[] = ESPERAS_NOVA_TENTATIVA_MS
) => {
  const postar: Postar = (body) => comNovaTentativa(() => postarUmaVez(body), esperas);
  const inicio = await postar({ acao: 'iniciar_video', ...destino, name: nome.replace(/\s+/g, '_'), mimeType, tamanho: file.size });
  if (!inicio?.sessao || !inicio?.folderId || !inicio?.folderLink) throw new Error(`Não foi possível iniciar o envio de ${nome}.`);
  for (let pos = 0; pos < file.size; pos += PARTE_VIDEO_BYTES) {
    const parte = file.slice(pos, Math.min(pos + PARTE_VIDEO_BYTES, file.size));
    const data = await postar({ acao: 'parte_video', sessao: inicio.sessao, inicio: pos, total: file.size, base64: await paraBase64(parte) });
    if (data?.concluido === true) {
      if (!data?.file?.id) break;
      return { folderId: String(inicio.folderId), folderLink: String(inicio.folderLink), fileId: String(data.file.id) };
    }
  }
  throw new Error(`O servidor não confirmou o arquivo ${nome}.`);
};

/**
 * Envia as evidencias de um produto e devolve o link da pasta no Drive.
 * Todos os arquivos ficam na mesma pasta (a primeira chamada cria; as seguintes reaproveitam pelo folderId).
 */
export const enviarEvidenciasDrive = async (
  arquivos: File[],
  pasta: PastaDestino,
  onProgresso?: (enviados: number, total: number) => void,
  postarUmaVez: Postar = postarPadrao,
  esperas: number[] = ESPERAS_NOVA_TENTATIVA_MS
) => {
  const postar: Postar = (body) => comNovaTentativa(() => postarUmaVez(body), esperas);
  if (!arquivos.length) throw new Error('Nenhuma evidência para enviar.');
  // String = pasta propria do produto (formato antigo); objeto = pasta do protocolo, reaproveitada pelo nome.
  const porProtocolo = typeof pasta !== 'string';
  const nomePasta = typeof pasta === 'string' ? pasta : pasta.nome;
  const prefixo = typeof pasta === 'string' || !pasta.prefixoArquivo ? '' : `${pasta.prefixoArquivo}_`;
  let folderId = '';
  let folderLink = '';
  let enviados = 0;
  const destino = () => (folderId ? { folderId } : { folderName: nomePasta, ...(porProtocolo ? { reusarPorNome: true } : {}) });
  const guardarPasta = (data: any) => {
    if (!data?.folderId || !data?.folderLink) throw new Error('O servidor não confirmou a pasta das evidências.');
    folderId = String(data.folderId);
    folderLink = String(data.folderLink);
  };

  // Fotos: em grupos que cabem numa chamada.
  const fotos = arquivos.filter((f) => tipoEvidencia(f) === 'foto');
  let grupo: { name: string; mimeType: string; base64: string }[] = [];
  const enviarGrupo = async () => {
    if (!grupo.length) return;
    const data = await postar({ ...destino(), files: grupo });
    if (data?.files?.length !== grupo.length || data.files.some((f: { id?: string }) => !f?.id)) throw new Error('O servidor não confirmou todas as fotos.');
    guardarPasta(data);
    enviados += grupo.length;
    onProgresso?.(enviados, arquivos.length);
    grupo = [];
  };
  for (const [indice, file] of fotos.entries()) {
    const { blob, nome } = await prepararFoto(file);
    const base64 = await paraBase64(blob);
    if (base64.length > MAX_FOTO_BASE64) throw new Error(`A foto ${file.name} é grande demais para enviar.`);
    if (grupo.reduce((t, f) => t + f.base64.length, 0) + base64.length > MAX_LOTE_FOTOS_BASE64) await enviarGrupo();
    grupo.push({ name: `${prefixo}Evidencia_${indice + 1}_${nome}`.replace(/\s+/g, '_'), mimeType: blob.type || 'image/jpeg', base64 });
  }
  await enviarGrupo();

  // Videos: sessao resumable no Drive e partes de 3 MB.
  for (const [indice, file] of arquivos.filter((f) => tipoEvidencia(f) === 'video').entries()) {
    try {
      guardarPasta(await enviarArquivoEmPartes(file, `${prefixo}Video_${indice + 1}_${file.name}`, file.type, destino(), postarUmaVez, esperas));
    } catch (error) {
      if (error instanceof Error && /iniciar o envio/.test(error.message)) throw new Error(`Não foi possível iniciar o envio do vídeo ${file.name}.`);
      if (error instanceof Error && /não confirmou o arquivo/.test(error.message)) throw new Error(`O servidor não confirmou o vídeo ${file.name}.`);
      throw error;
    }
    enviados += 1;
    onProgresso?.(enviados, arquivos.length);
  }
  return folderLink;
};
