import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
.ev-input { display: none; }
body.dark-mode .ev-botao { background: #111827; color: #e2e8f0; border-color: #475569; }
`;

// A janela vai direto no <body> (portal): dentro da celula da tabela ela ficava presa a rolagem lateral da tabela.
const estiloJanela = `
.ev-fundo { position: fixed; inset: 0; z-index: 1000; background: rgba(15, 23, 42, 0.6); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: inherit; }
.ev-modal { --ev-azul: #1d4ed8; --ev-navy: #0f2356; --ev-borda: #e2e8f0; --ev-muted: #64748b; --ev-fundo: #f8fafc;
  width: 100%; max-width: 560px; max-height: min(88vh, 760px); display: grid; grid-template-rows: auto 1fr auto; background: #fff;
  border-radius: 16px; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28); overflow: hidden; }
.ev-topo { display: flex; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--ev-borda); }
.ev-topo-icone { width: 40px; height: 40px; flex: none; border-radius: 10px; background: #eaf0ff; color: var(--ev-azul); display: grid; place-items: center; }
.ev-topo-icone .material-icons { font-size: 22px; }
.ev-topo-texto { min-width: 0; flex: 1; }
.ev-topo h3 { margin: 0; font-size: 1rem; font-weight: 700; color: var(--ev-navy); }
.ev-topo small { display: block; margin-top: 2px; font-size: 0.8rem; color: var(--ev-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-fechar { width: 36px; height: 36px; flex: none; border: none; border-radius: 10px; background: transparent; color: var(--ev-muted); display: grid; place-items: center; cursor: pointer; }
.ev-fechar:hover { background: var(--ev-fundo); color: var(--ev-navy); }
.ev-corpo { overflow-y: auto; padding: 16px 18px; display: grid; gap: 14px; align-content: start; }
.ev-info { margin: 0; font-size: 0.82rem; line-height: 1.45; color: var(--ev-muted); }
.ev-aviso { display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; padding: 8px 10px; border-radius: 10px; }
.ev-aviso .material-icons { font-size: 18px; flex: none; }
.ev-vazio { display: grid; justify-items: center; gap: 6px; padding: 22px 12px; border: 1.5px dashed #cbd5e1; border-radius: 12px; background: var(--ev-fundo); color: var(--ev-muted); font-size: 0.85rem; text-align: center; }
.ev-vazio .material-icons { font-size: 32px; color: #94a3b8; }
.ev-grade-topo { display: flex; justify-content: space-between; align-items: baseline; font-size: 0.8rem; color: var(--ev-muted); }
.ev-grade-topo strong { color: var(--ev-navy); font-size: 0.85rem; }
.ev-grade { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ev-mini { position: relative; margin: 0; aspect-ratio: 1; border-radius: 12px; overflow: hidden; border: 1px solid var(--ev-borda); background: #0f172a; }
.ev-mini img, .ev-mini video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ev-mini-tipo { position: absolute; left: 6px; top: 6px; display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px 2px 5px; border-radius: 999px; background: rgba(15, 23, 42, 0.7); color: #fff; font-size: 0.68rem; font-weight: 600; }
.ev-mini-tipo .material-icons { font-size: 14px; }
.ev-mini figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 8px 5px; font-size: 0.68rem; color: #fff; background: linear-gradient(transparent, rgba(0,0,0,0.7)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-remover { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(15, 23, 42, 0.7); color: #fff; display: grid; place-items: center; cursor: pointer; padding: 0; }
.ev-remover:hover { background: #dc2626; }
.ev-remover .material-icons { font-size: 16px; }
.ev-anexar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ev-anexar button { display: grid; justify-items: center; align-content: center; gap: 6px; min-height: 76px; padding: 10px 6px; border-radius: 12px; border: 1px solid var(--ev-borda); background: #fff; color: var(--ev-navy); font-family: inherit; font-size: 0.8rem; font-weight: 600; text-align: center; cursor: pointer; transition: border-color .15s, background .15s; }
.ev-anexar button .material-icons { font-size: 24px; color: var(--ev-azul); }
.ev-anexar button:hover:not(:disabled) { border-color: var(--ev-azul); background: #f5f8ff; }
.ev-anexar button:disabled, .ev-remover:disabled { opacity: 0.5; cursor: not-allowed; }
.ev-rodape { padding: 12px 18px 16px; border-top: 1px solid var(--ev-borda); }
.ev-ok { width: 100%; min-height: 44px; border: none; border-radius: 10px; background: var(--ev-azul); color: #fff; font-family: inherit; font-size: 0.92rem; font-weight: 700; cursor: pointer; }
.ev-ok:hover { background: #1e40af; }
.ev-fechar:focus-visible, .ev-ok:focus-visible, .ev-anexar button:focus-visible, .ev-remover:focus-visible { outline: 2px solid var(--ev-azul); outline-offset: 2px; }
@media (max-width: 480px) {
  .ev-fundo { padding: 0; align-items: flex-end; }
  .ev-modal { max-width: none; max-height: 92dvh; border-radius: 16px 16px 0 0; }
  .ev-grade { gap: 8px; }
  .ev-anexar { gap: 8px; }
  .ev-anexar button { min-height: 70px; font-size: 0.76rem; }
}
body.dark-mode .ev-modal { --ev-borda: #334155; --ev-muted: #94a3b8; --ev-fundo: #111827; --ev-navy: #e2e8f0; background: #1f2937; }
body.dark-mode .ev-topo-icone { background: #1e293b; }
body.dark-mode .ev-anexar button { background: #111827; }
body.dark-mode .ev-anexar button:hover:not(:disabled) { background: #172036; }
body.dark-mode .ev-aviso { background: #3a2a0a; border-color: #78520f; color: #fcd34d; }
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
    // Com a janela aberta a pagina de tras nao rola (no celular o dedo rolava a tabela por baixo).
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', fechar); document.body.style.overflow = overflowAntes; };
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

      {aberto && createPortal(
        <div className="ev-fundo" onClick={() => setAberto(false)}>
          <style>{estiloJanela}</style>
          <section className="ev-modal" role="dialog" aria-modal="true" aria-label={`Evidências do serial ${serial}`} onClick={(e) => e.stopPropagation()}>
            <header className="ev-topo">
              <span className="ev-topo-icone" aria-hidden="true"><i className="material-icons">perm_media</i></span>
              <div className="ev-topo-texto">
                <h3>Evidências</h3>
                <small>Serial {serial}</small>
              </div>
              <button type="button" className="ev-fechar" aria-label="Fechar" onClick={() => setAberto(false)}>
                <i className="material-icons" aria-hidden="true">close</i>
              </button>
            </header>

            <div className="ev-corpo">
              <p className="ev-info">Fotos e vídeos: até {MAX_ARQUIVOS_EVIDENCIA} arquivos; vídeo de até {MAX_VIDEO_MB} MB.</p>
              {recomendado && !arquivos.length && (
                <div className="ev-aviso"><i className="material-icons" aria-hidden="true">warning_amber</i>Item com avaria: anexe ao menos uma foto da avaria.</div>
              )}
              {avisos.map((a) => <div key={a} className="ev-aviso" role="alert"><i className="material-icons" aria-hidden="true">info</i>{a}</div>)}

              {arquivos.length === 0 ? (
                <div className="ev-vazio">
                  <i className="material-icons" aria-hidden="true">add_photo_alternate</i>
                  Nenhuma evidência anexada ainda.
                </div>
              ) : (
                <div>
                  <div className="ev-grade-topo"><strong>Anexados</strong><span>{arquivos.length} de {MAX_ARQUIVOS_EVIDENCIA}</span></div>
                  <div className="ev-grade" style={{ marginTop: 8 }}>
                    {arquivos.map((file, indice) => {
                      const video = tipoEvidencia(file) === 'video';
                      return (
                        <figure key={`${file.name}|${file.size}|${file.lastModified}`} className="ev-mini">
                          {video
                            ? <video src={previews[indice]} preload="metadata" muted playsInline aria-label={`Vídeo ${indice + 1}`} />
                            : <img src={previews[indice]} alt={`Evidência ${indice + 1}`} />}
                          {video && <span className="ev-mini-tipo"><i className="material-icons" aria-hidden="true">play_arrow</i>Vídeo</span>}
                          <figcaption>{file.name}</figcaption>
                          <button type="button" className="ev-remover" aria-label={`Remover ${file.name}`} disabled={desabilitado}
                            onClick={() => onChange(arquivos.filter((_, i) => i !== indice))}>
                            <i className="material-icons" aria-hidden="true">close</i>
                          </button>
                        </figure>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="ev-anexar">
                <button type="button" disabled={desabilitado} onClick={() => fotoRef.current?.click()}><i className="material-icons" aria-hidden="true">photo_camera</i>Tirar foto</button>
                <button type="button" disabled={desabilitado} onClick={() => videoRef.current?.click()}><i className="material-icons" aria-hidden="true">videocam</i>Gravar vídeo</button>
                <button type="button" disabled={desabilitado} onClick={() => arquivoRef.current?.click()}><i className="material-icons" aria-hidden="true">photo_library</i>Galeria</button>
              </div>
            </div>

            <footer className="ev-rodape">
              <button type="button" className="ev-ok" onClick={() => setAberto(false)}>Concluir</button>
            </footer>

            <input ref={fotoRef} className="ev-input" type="file" accept="image/*" capture="environment" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
            <input ref={videoRef} className="ev-input" type="file" accept="video/*" capture="environment" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
            <input ref={arquivoRef} className="ev-input" type="file" accept="image/*,video/*" multiple onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
          </section>
        </div>,
        document.body
      )}
    </>
  );
};

export default EvidenciasItem;
