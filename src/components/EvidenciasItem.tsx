import { useEffect, useMemo, useRef, useState } from 'react';
import { filtrarEvidencias, MAX_ARQUIVOS_EVIDENCIA, MAX_VIDEO_MB, resumoEvidencias, tipoEvidencia } from '../lib/evidenciasDrive';

type Props = {
  arquivos: File[];
  /** Avaria: sem evidencia o item vira rascunho (aviso, nao bloqueia). */
  recomendado: boolean;
  /** Pasta do Drive, depois que o lote foi enviado. */
  linkDrive?: string;
  desabilitado?: boolean;
  serial: string;
  onChange: (arquivos: File[]) => void;
};

const estilo = `
.ev-botao { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 999px; border: 1px dashed #94a3b8; background: #fff; color: #334155; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ev-botao .material-icons { font-size: 16px; }
.ev-botao.tem { border-style: solid; border-color: #16a34a; background: #ecfdf3; color: #166534; }
.ev-botao.recomendado { border-color: #d97706; color: #92400e; background: #fffbeb; }
.ev-botao:disabled { opacity: 0.5; cursor: not-allowed; }
.ev-drive { display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; font-weight: 700; color: #166534; }
.ev-fundo { position: fixed; inset: 0; z-index: 1000; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.ev-modal { width: 100%; max-width: 640px; max-height: 90vh; overflow: auto; background: #fff; border-radius: 12px; padding: 18px; display: grid; gap: 12px; }
.ev-modal h3 { margin: 0; font-size: 1rem; color: #0f2356; }
.ev-modal p { margin: 0; font-size: 0.82rem; color: #64748b; }
.ev-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.ev-mini { position: relative; margin: 0; aspect-ratio: 1; border-radius: 8px; overflow: hidden; border: 1px solid #dbe4f0; background: #0f172a; }
.ev-mini img, .ev-mini video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ev-mini figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 6px; font-size: 0.7rem; color: #fff; background: rgba(0,0,0,0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-remover { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; border: none; border-radius: 50%; background: rgba(0,0,0,0.65); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.ev-remover .material-icons { font-size: 16px; }
.ev-acoes { display: flex; flex-wrap: wrap; gap: 8px; }
.ev-acoes button { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-weight: 600; font-size: 0.85rem; cursor: pointer; color: #0f2356; }
.ev-acoes button.ev-ok { margin-left: auto; background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
.ev-aviso { font-size: 0.8rem; color: #92400e; background: #fffbeb; padding: 6px 10px; border-radius: 6px; }
.ev-input { display: none; }
body.dark-mode .ev-modal { background: #1f2937; }
body.dark-mode .ev-modal h3 { color: #e2e8f0; }
body.dark-mode .ev-botao, body.dark-mode .ev-acoes button:not(.ev-ok) { background: #111827; color: #e2e8f0; border-color: #475569; }
`;

/** Celula "Evidências" da conferencia: mostra o que esta anexado e abre a janela para anexar/remover. */
const EvidenciasItem = ({ arquivos, recomendado, linkDrive, desabilitado = false, serial, onChange }: Props) => {
  const [aberto, setAberto] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const fotoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const previews = useMemo(() => (aberto ? arquivos.map((file) => URL.createObjectURL(file)) : []), [arquivos, aberto]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aberto]);

  const receber = (lista?: FileList | null) => {
    const { aceitos, avisos: novos } = filtrarEvidencias(arquivos, Array.from(lista || []));
    setAvisos(novos);
    if (aceitos.length) onChange([...arquivos, ...aceitos]);
  };

  if (linkDrive) {
    return <a className="ev-drive" href={linkDrive} target="_blank" rel="noopener noreferrer"><i className="material-icons" aria-hidden="true">cloud_done</i>Ver no Drive</a>;
  }

  const resumo = resumoEvidencias(arquivos);
  return (
    <>
      <style>{estilo}</style>
      <button type="button" className={`ev-botao${arquivos.length ? ' tem' : recomendado ? ' recomendado' : ''}`} disabled={desabilitado}
        onClick={() => { setAvisos([]); setAberto(true); }} aria-label={`Evidências do serial ${serial}${resumo ? `: ${resumo}` : ''}`}>
        <i className="material-icons" aria-hidden="true">{arquivos.length ? 'perm_media' : 'add_a_photo'}</i>
        {resumo || (recomendado ? 'Anexar (avaria)' : 'Anexar')}
      </button>

      {aberto && (
        <div className="ev-fundo" onClick={() => setAberto(false)}>
          <section className="ev-modal" role="dialog" aria-modal="true" aria-label={`Evidências do serial ${serial}`} onClick={(e) => e.stopPropagation()}>
            <h3>Evidências · serial {serial}</h3>
            <p>Fotos e vídeos vão para a pasta do produto no Google Drive quando o lote for enviado. Até {MAX_ARQUIVOS_EVIDENCIA} arquivos; vídeo de até {MAX_VIDEO_MB} MB.</p>
            {recomendado && !arquivos.length && <div className="ev-aviso">Item com avaria: anexe ao menos uma foto da avaria.</div>}
            {avisos.map((a) => <div key={a} className="ev-aviso" role="alert">{a}</div>)}
            {arquivos.length > 0 && (
              <div className="ev-grade">
                {arquivos.map((file, indice) => (
                  <figure key={`${file.name}|${file.size}|${file.lastModified}`} className="ev-mini">
                    {tipoEvidencia(file) === 'video'
                      ? <video src={previews[indice]} controls preload="metadata" />
                      : <img src={previews[indice]} alt={`Evidência ${indice + 1}`} />}
                    <figcaption>{file.name}</figcaption>
                    <button type="button" className="ev-remover" aria-label={`Remover ${file.name}`} disabled={desabilitado}
                      onClick={() => onChange(arquivos.filter((_, i) => i !== indice))}>
                      <i className="material-icons" aria-hidden="true">close</i>
                    </button>
                  </figure>
                ))}
              </div>
            )}
            <div className="ev-acoes">
              <button type="button" disabled={desabilitado} onClick={() => fotoRef.current?.click()}><i className="material-icons" aria-hidden="true">photo_camera</i>Tirar foto</button>
              <button type="button" disabled={desabilitado} onClick={() => videoRef.current?.click()}><i className="material-icons" aria-hidden="true">videocam</i>Gravar vídeo</button>
              <button type="button" disabled={desabilitado} onClick={() => arquivoRef.current?.click()}><i className="material-icons" aria-hidden="true">attach_file</i>Escolher arquivos</button>
              <button type="button" className="ev-ok" onClick={() => setAberto(false)}>Concluir</button>
            </div>
            <input ref={fotoRef} className="ev-input" type="file" accept="image/*" capture="environment" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
            <input ref={videoRef} className="ev-input" type="file" accept="video/*" capture="environment" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
            <input ref={arquivoRef} className="ev-input" type="file" accept="image/*,video/*" multiple onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
          </section>
        </div>
      )}
    </>
  );
};

export default EvidenciasItem;
