import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { oracleApi } from '../lib/oracle';

type Aviso = { id: number; protocolo: string; tipo?: string; mensagem: string; criado_em: string };

export default function Notificacoes() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const dialogo = useRef<HTMLDialogElement>(null);
  const lidos = useRef(new Set<number>());
  useEffect(() => {
    if (aberto) dialogo.current?.showModal();
    else dialogo.current?.close();
  }, [aberto]);
  const [cnpj] = useState(() => {
    try { return String(JSON.parse(localStorage.getItem('gat_user_profile') || '{}').cnpj || '').replace(/\D/g, ''); }
    catch { return ''; }
  });
  useEffect(() => {
    if (!cnpj) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const carregar = async () => {
      try {
        const response = await oracleApi.get<Aviso[]>('/notificacoes_pa', { params: { cnpj } });
        if (!Array.isArray(response.data)) throw new Error('Resposta inválida');
        if (!stopped) { setAvisos(response.data.filter((aviso) => !lidos.current.has(aviso.id))); setErro(''); }
      } catch {
        if (!stopped) setErro('Não foi possível atualizar os avisos. Tentaremos novamente.');
      } finally {
        if (!stopped) setCarregando(false);
        if (!stopped) timer = setTimeout(carregar, 30000);
      }
    };
    void carregar();
    return () => { stopped = true; clearTimeout(timer); };
  }, [cnpj]);
  const marcar = async (id: number) => {
    setOcupado(id);
    try {
      await oracleApi.post('/notificacoes_pa', { cnpj, id });
      lidos.current.add(id);
      setAvisos((lista) => lista.filter((aviso) => aviso.id !== id));
      setErro('');
    } catch { setErro('Não foi possível marcar o aviso como lido. Tente novamente.'); }
    finally { setOcupado(null); }
  };
  return (
    <section className="pa-avisos" aria-label="Notificações do posto">
      <button type="button" className="nav-item pa-sininho" aria-label={`Notificações: ${erro ? 'atualização indisponível' : carregando && cnpj ? 'carregando' : `${avisos.length >= 100 ? '100 ou mais' : avisos.length} não lidas`}`} title="Notificações do posto" aria-haspopup="dialog" aria-expanded={aberto} aria-controls="pa-avisos-lista" onClick={() => setAberto(!aberto)}>
        <i className="material-icons" aria-hidden="true">notifications</i>
        <span>Notificações</span>
        {(avisos.length > 0 || erro) && <b className="pa-contador" aria-hidden="true">{erro ? '!' : avisos.length >= 100 ? '99+' : avisos.length}</b>}
      </button>
      <span className="pa-sr-only" role="status">{!carregando && !erro && `${avisos.length} notificações não lidas`}</span>
      {createPortal(<dialog ref={dialogo} id="pa-avisos-lista" className="pa-avisos-lista" aria-labelledby="pa-avisos-titulo" onCancel={() => setAberto(false)} onClose={() => setAberto(false)}>
        <header className="pa-avisos-header"><h3 id="pa-avisos-titulo">Notificações do posto</h3><button type="button" autoFocus onClick={() => setAberto(false)} aria-label="Fechar notificações">✕</button></header>
        <p className="pa-avisos-ajuda">Mudanças de status e propostas de negociação. Atualização automática a cada 30 segundos.</p>
        {erro && <p role="alert">{erro}</p>}
        {!cnpj && <p>Entre novamente para identificar seu posto.</p>}
        {cnpj && carregando && <p>Carregando notificações…</p>}
        {cnpj && !carregando && !erro && !avisos.length && <p>Nenhuma notificação pendente. Você está em dia!</p>}
        {avisos.map((aviso) => <article key={aviso.id}>
          <small className="pa-aviso-tipo">{aviso.tipo === 'NEGOCIACAO' ? 'Nova proposta de negociação' : 'Alteração de status'}</small>
          <strong>Protocolo {aviso.protocolo}</strong>
          <p>{aviso.mensagem}</p>
          <small>{new Date(aviso.criado_em).toLocaleString('pt-BR')}</small>
          <div>
            <Link to={'/meus-envios?protocolo=' + encodeURIComponent(aviso.protocolo)} onClick={() => setAberto(false)}>Ver orçamento</Link>
            <button type="button" disabled={ocupado !== null} onClick={() => void marcar(aviso.id)}>{ocupado === aviso.id ? 'Salvando…' : 'Marcar como lido'}</button>
          </div>
        </article>)}
      </dialog>, document.body)}
    </section>
  );
}
