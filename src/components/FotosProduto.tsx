import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  fotos: File[];
  obrigatorio: boolean;
  linkDriveAtual?: string;
  enviando?: boolean;
  onAdicionar: (files: File[]) => void;
  onRemover: (index: number) => void;
};

const chaveArquivo = (file: File) => `${file.name}|${file.size}|${file.lastModified}`;

const FotosProduto = ({ fotos, obrigatorio, linkDriveAtual, enviando = false, onAdicionar, onRemover }: Props) => {
  const galeriaRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [ampliada, setAmpliada] = useState<number | null>(null);

  const previews = useMemo(() => fotos.map((file) => URL.createObjectURL(file)), [fotos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  useEffect(() => {
    if (ampliada === null) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAmpliada(null); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [ampliada]);

  const receber = (lista?: FileList | null) => {
    const arquivos = Array.from(lista || []);
    if (!arquivos.length) return;
    const existentes = new Set(fotos.map(chaveArquivo));
    const imagens = arquivos.filter((file) => file.type.startsWith('image/'));
    const novas = imagens.filter((file) => !existentes.has(chaveArquivo(file)));
    const avisos = [
      arquivos.length > imagens.length ? `${arquivos.length - imagens.length} arquivo(s) ignorado(s): envie apenas imagens.` : '',
      imagens.length > novas.length ? `${imagens.length - novas.length} foto(s) já estava(m) anexada(s).` : ''
    ].filter(Boolean);
    setAviso(avisos.join(' '));
    if (novas.length) onAdicionar(novas);
  };

  const pendente = obrigatorio && fotos.length === 0 && !linkDriveAtual;

  return (
    <div
      className={`fotos-produto${arrastando ? ' arrastando' : ''}${pendente ? ' pendente' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!enviando) setArrastando(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        if (!enviando) receber(e.dataTransfer.files);
      }}
    >
      <div className="fotos-produto-cabecalho">
        <span className="fotos-produto-titulo">
          <i className="material-icons" aria-hidden="true">photo_camera</i>
          Fotos do produto
          {obrigatorio && <span className="fotos-produto-obrigatorio">obrigatório</span>}
        </span>
        {fotos.length > 0 && <span className="fotos-produto-contador">{fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'}</span>}
      </div>

      {linkDriveAtual && (
        <div className="fotos-produto-drive">
          <i className="material-icons" aria-hidden="true">cloud_done</i>
          <span>
            Fotos já enviadas.{' '}
            <a href={linkDriveAtual} target="_blank" rel="noopener noreferrer">Abrir pasta no Drive</a>
            {fotos.length > 0 && <> — ao salvar, as novas fotos substituem esse link.</>}
          </span>
        </div>
      )}

      {pendente && (
        <div className="fotos-produto-alerta" role="alert">
          O defeito selecionado exige ao menos uma foto da avaria.
        </div>
      )}

      <div className="fotos-produto-grade">
        {fotos.map((file, index) => (
          <figure key={chaveArquivo(file)} className="fotos-produto-miniatura">
            <button type="button" className="fotos-produto-ver" onClick={() => setAmpliada(index)} title={`Ampliar ${file.name}`}>
              <img src={previews[index]} alt={`Foto ${index + 1} do produto`} />
            </button>
            <button
              type="button"
              className="fotos-produto-remover"
              onClick={() => { setAviso(''); onRemover(index); }}
              disabled={enviando}
              aria-label={`Remover foto ${index + 1}`}
              title="Remover"
            >
              <i className="material-icons" aria-hidden="true">close</i>
            </button>
          </figure>
        ))}
        <button type="button" className="fotos-produto-adicionar" onClick={() => cameraRef.current?.click()} disabled={enviando}>
          <i className="material-icons" aria-hidden="true">photo_camera</i>
          <span>Tirar foto</span>
        </button>
        <button type="button" className="fotos-produto-adicionar" onClick={() => galeriaRef.current?.click()} disabled={enviando}>
          <i className="material-icons" aria-hidden="true">add_photo_alternate</i>
          <span>Galeria</span>
        </button>
      </div>

      <div className="fotos-produto-rodape" aria-live="polite">
        {enviando && fotos.length > 0
          ? <><span className="novo-orcamento-spinner" aria-hidden="true" /> Enviando {fotos.length} {fotos.length === 1 ? 'foto' : 'fotos'} para o Google Drive...</>
          : aviso || 'Toque para fotografar ou escolher da galeria. No computador, também dá para arrastar as imagens até aqui.'}
      </div>

      <input ref={galeriaRef} type="file" accept="image/*" multiple className="fotos-drive-input" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="fotos-drive-input" onChange={(e) => { receber(e.target.files); e.currentTarget.value = ''; }} />

      {ampliada !== null && previews[ampliada] && (
        <div className="fotos-produto-modal" role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={() => setAmpliada(null)}>
          <img src={previews[ampliada]} alt={`Foto ${ampliada + 1} do produto`} />
          <button type="button" className="fotos-produto-fechar" onClick={() => setAmpliada(null)} aria-label="Fechar">
            <i className="material-icons" aria-hidden="true">close</i>
          </button>
        </div>
      )}
    </div>
  );
};

export default FotosProduto;
