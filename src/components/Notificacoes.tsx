import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { oracleApi } from '../lib/oracle';

type Aviso = { id: number; protocolo: string; mensagem: string; criado_em: string };

export default function Notificacoes() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<number | null>(null);
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
        if (!stopped) { setAvisos(response.data); setErro(''); }
      } catch {
        if (!stopped) setErro('Não foi possível atualizar os avisos. Tentaremos novamente.');
      } finally {
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
      setAvisos((lista) => lista.filter((aviso) => aviso.id !== id));
      setErro('');
    } catch { setErro('Não foi possível marcar o aviso como lido. Tente novamente.'); }
    finally { setOcupado(null); }
  };
  return (
    <section className="pa-avisos" aria-label="Notificações do posto">
      <button type="button" className="btn btn-secondary" aria-expanded={aberto} aria-controls="pa-avisos-lista" onClick={() => setAberto(!aberto)}>
        Avisos ({avisos.length >= 100 ? '100+' : avisos.length}){erro ? ' · Indisponível' : ''}
      </button>
      {aberto && <div id="pa-avisos-lista" className="pa-avisos-lista">
        <h3>Avisos não lidos</h3>
        {erro && <p role="alert">{erro}</p>}
        {!cnpj && <p>Entre novamente para identificar seu posto.</p>}
        {cnpj && !erro && !avisos.length && <p>Nenhum aviso não lido.</p>}
        {avisos.map((aviso) => <article key={aviso.id}>
          <strong>Protocolo {aviso.protocolo}</strong>
          <p>{aviso.mensagem}</p>
          <small>{new Date(aviso.criado_em).toLocaleString('pt-BR')}</small>
          <div>
            <Link to={'/meus-envios?protocolo=' + encodeURIComponent(aviso.protocolo)} onClick={() => setAberto(false)}>Ver orçamento</Link>
            <button type="button" disabled={ocupado !== null} onClick={() => void marcar(aviso.id)}>{ocupado === aviso.id ? 'Salvando…' : 'Marcar como lido'}</button>
          </div>
        </article>)}
      </div>}
    </section>
  );
}
