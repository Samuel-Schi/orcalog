import { useMemo, useState } from 'react';

type Status = 'RASCUNHO' | 'PENDENTE' | 'EM ANDAMENTO' | 'FINALIZADO';

const MOCK = [
  { protocolo: 'P1703-2381', data: '17/03/2026', status: 'PENDENTE' as Status },
  { protocolo: 'P1703-5920', data: '17/03/2026', status: 'EM ANDAMENTO' as Status },
  { protocolo: 'P1703-7744', data: '14/03/2026', status: 'FINALIZADO' as Status }
];

const MeusEnvios = () => {
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'' | Status>('');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const filtrados = useMemo(() => {
    const termo = filtroTexto.trim().toLowerCase();
    return MOCK.filter((p) => {
      const matchTexto = !termo || p.protocolo.toLowerCase().includes(termo);
      const matchStatus = !filtroStatus || p.status === filtroStatus;
      return matchTexto && matchStatus;
    });
  }, [filtroTexto, filtroStatus]);

  const statusCor = (status: Status) => {
    if (status === 'EM ANDAMENTO') return 'var(--status-andamento)';
    if (status === 'FINALIZADO') return 'var(--status-finalizado)';
    return 'var(--status-pendente)';
  };

  return (
    <div id="viewAcompanhamento" className="view-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <h2 className="page-title" style={{ marginBottom: 0, paddingBottom: 5, fontSize: '1.1rem', borderBottom: 'none' }}>Meus Envios</h2>
        <button className="btn btn-secondary btn-sm" type="button">
          <i className="material-icons" style={{ fontSize: 14, marginRight: 4 }}>refresh</i>
          Atualizar
        </button>
      </div>

      <div className="filter-bar">
        <i className="material-icons" style={{ color: '#888' }}>search</i>
        <input
          type="text"
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por Protocolo..."
          className="search-input"
        />
        <select
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as Status | '')}
          style={{ width: 200 }}
        >
          <option value="">Todos Status</option>
          <option value="RASCUNHO">Em Digitação</option>
          <option value="PENDENTE">Pendente</option>
          <option value="EM ANDAMENTO">Em Andamento</option>
          <option value="FINALIZADO">Finalizado</option>
        </select>
      </div>

      <div id="listaAcompanhamentoPA">
        {filtrados.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Nenhum registro encontrado.</p>
        )}

        {filtrados.map((prot) => (
          <div key={prot.protocolo} className={`protocolo-card ${abertos[prot.protocolo] ? 'open' : ''}`}>
            <div
              className="protocolo-header"
              onClick={() => setAbertos((prev) => ({ ...prev, [prot.protocolo]: !prev[prot.protocolo] }))}
            >
              <div className="header-info-main">
                <span className="header-title">{prot.protocolo}</span>
                <span className="header-sub">{prot.data}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span className="status-badge" style={{ background: statusCor(prot.status) }}>{prot.status}</span>
                <i className="material-icons arrow-icon">keyboard_arrow_down</i>
              </div>
            </div>
            <div className="protocolo-detalhes">
              <div className="table-scroll">
                <table className="tabela-horizontal">
                  <thead>
                    <tr>
                      <th>NF Remessa</th>
                      <th>Data NF</th>
                      <th>Cód. GEMCO</th>
                      <th>Descrição</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>78912</td>
                      <td>16/03/2026</td>
                      <td><strong>889900</strong></td>
                      <td>Micro-ondas 20L</td>
                      <td style={{ fontWeight: 'bold', background: '#fff3cd' }}>R$ 420,00</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" style={{ backgroundColor: '#217346' }}>
                  <i className="material-icons">description</i>
                  Excel
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MeusEnvios;
