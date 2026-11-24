import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type AvisoPopup = { tipo: 'sucesso' | 'erro'; titulo: string; mensagem?: ReactNode };

const estilo = `
.pop-fundo { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgba(15, 23, 42, .45); backdrop-filter: blur(2px); animation: pop-fade .15s ease-out; }
.pop-caixa { width: 100%; max-width: 420px; background: #fff; border-radius: 18px; padding: 28px 24px 22px; text-align: center;
  box-shadow: 0 24px 60px rgba(15, 23, 42, .28); animation: pop-sobe .18s ease-out; font-family: inherit; }
.pop-icone { width: 64px; height: 64px; margin: 0 auto; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.pop-icone .material-icons { font-size: 38px; }
.pop-sucesso .pop-icone { background: #dcfce7; color: #15803d; box-shadow: 0 0 0 8px #f0fdf4; }
.pop-erro .pop-icone { background: #fee2e2; color: #b91c1c; box-shadow: 0 0 0 8px #fef2f2; }
.pop-titulo { margin: 18px 0 6px; font-size: 1.15rem; font-weight: 700; color: #0f172a; }
.pop-msg { margin: 0; font-size: .92rem; line-height: 1.45; color: #475569; }
.pop-botao { margin-top: 22px; min-width: 140px; border: 0; border-radius: 10px; padding: 11px 22px; font-weight: 700; font-size: .92rem;
  color: #fff; cursor: pointer; }
.pop-sucesso .pop-botao { background: #16a34a; } .pop-sucesso .pop-botao:hover { background: #15803d; }
.pop-erro .pop-botao { background: #dc2626; } .pop-erro .pop-botao:hover { background: #b91c1c; }
@keyframes pop-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-sobe { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
`;

/** Pop-up central de "deu certo" / "deu erro": o posto não perde a mensagem como num aviso pequeno. */
export default function PopupAviso({ aviso, onClose }: { aviso: AvisoPopup | null; onClose: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const fechar = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter') onClose(); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aviso, onClose]);
  if (!aviso) return null;
  // No body: o pop-up não fica preso dentro de cartões com overflow/transform da página.
  return createPortal(
    <div className="pop-fundo" onClick={(event) => { event.stopPropagation(); onClose(); }}>
      <style>{estilo}</style>
      <div className={`pop-caixa pop-${aviso.tipo}`} role={aviso.tipo === 'erro' ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-labelledby="pop-titulo" onClick={(event) => event.stopPropagation()}>
        <div className="pop-icone"><i className="material-icons" aria-hidden="true">{aviso.tipo === 'sucesso' ? 'check_circle' : 'error'}</i></div>
        <h2 id="pop-titulo" className="pop-titulo">{aviso.titulo}</h2>
        {aviso.mensagem && <p className="pop-msg">{aviso.mensagem}</p>}
        <button type="button" className="pop-botao" autoFocus onClick={onClose}>Entendi</button>
      </div>
    </div>,
    document.body
  );
}
