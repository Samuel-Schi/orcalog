import { useEffect, useMemo, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { getStatusLabel } from '../lib/statusMap';

type ItemEnvio = {
  id: string;
  protocolo: string;
  codBarras: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  status: number;
  criadoEm?: string;
  totalOrcamento?: number;
  valPecas?: number;
  valAcess?: number;
  valMaoObra?: number;
  valEmb?: number;
  valHig?: number;
};

const MeusEnvios = () => {
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'' | number>('');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<ItemEnvio[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const carregar = async () => {
    try {
      setIsLoading(true);
      let cnpj = '';
      const profileRaw = localStorage.getItem('gat_user_profile');
      if (profileRaw) {
        try {
          const profile = JSON.parse(profileRaw) as { cnpj?: string };
          if (profile.cnpj) cnpj = String(profile.cnpj);
        } catch {
          // ignore
        }
      }

      if (!cnpj) {
        const usuario = (localStorage.getItem('gat_user') || '').toLowerCase();
        if (usuario) {
          const res = await oracleApi.get(ORACLE_ENDPOINTS.getUserInf, {
            params: { usuario, _ts: Date.now() },
            responseType: 'arraybuffer',
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            validateStatus: (status) => status >= 200 && status < 400
          });
          const data = parseMaybeJson(res.data);
          const list: any[] = Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data)
              ? data
              : [];
          const item = list[0] ?? data ?? {};
          if (item?.cnpj) cnpj = String(item.cnpj);
        }
      }

      if (!cnpj) return;
      const res = await oracleApi.get(ORACLE_ENDPOINTS.getEnvios, {
        params: { cnpj, _ts: Date.now() },
        responseType: 'arraybuffer',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        validateStatus: (status) => status >= 200 && status < 400
      });

      const data = parseMaybeJson(res.data);
      const list: any[] = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];

      const normalized = list.map((row, index) => ({
        id: String(row.id ?? row.ID ?? `${row.protocolo ?? row.PROTOCOLO ?? 'p'}-${index}`),
        protocolo: String(row.protocolo ?? row.PROTOCOLO ?? ''),
        codBarras: String(row.cod_barras ?? row.COD_BARRAS ?? row.codBarras ?? ''),
        codGemco: String(row.cod_gemco ?? row.COD_GEMCO ?? row.codGemco ?? ''),
        descricao: String(row.descricao ?? row.DESCRICAO ?? ''),
        fornecedor: String(row.fornecedor ?? row.FORNECEDOR ?? ''),
        linha: String(row.linha ?? row.LINHA ?? ''),
        serial: String(row.serial ?? row.SERIAL ?? ''),
        status: Number(row.status ?? row.STATUS ?? 1),
        criadoEm: String(row.criado_em ?? row.CRIADO_EM ?? ''),
        totalOrcamento: row.total_orcamento ?? row.TOTAL_ORCAMENTO ?? row.totalOrcamento
        ,
        valPecas: row.val_pecas ?? row.VAL_PECAS ?? row.valPecas,
        valAcess: row.val_acess ?? row.VAL_ACESS ?? row.valAcess,
        valMaoObra: row.val_mao_obra ?? row.VAL_MAO_OBRA ?? row.valMaoObra,
        valEmb: row.val_emb ?? row.VAL_EMB ?? row.valEmb,
        valHig: row.val_hig ?? row.VAL_HIG ?? row.valHig
      })) as ItemEnvio[];

      setItems(normalized);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const grupos = useMemo(() => {
    const map = new Map<string, ItemEnvio[]>();
    items.forEach((item) => {
      const key = item.protocolo || 'SEM PROTOCOLO';
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    });
    return Array.from(map.entries());
  }, [items]);

  const filtrados = useMemo(() => {
    const termo = filtroTexto.trim().toLowerCase();
    return grupos.filter(([protocolo, itens]) => {
      const matchTexto = !termo || protocolo.toLowerCase().includes(termo);
      const statusAtual = Math.max(...itens.map((i) => i.status || 1));
      const matchStatus = !filtroStatus || statusAtual === filtroStatus;
      return matchTexto && matchStatus;
    });
  }, [filtroTexto, filtroStatus, grupos]);

  const statusCor = (status: number) => {
    if (status === 3) return 'var(--status-andamento)';
    if (status === 4) return 'var(--status-finalizado)';
    return 'var(--status-pendente)';
  };

  return (
    <div id="viewAcompanhamento" className="view-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <h2 className="page-title" style={{ marginBottom: 0, paddingBottom: 5, fontSize: '1.1rem', borderBottom: 'none' }}>Meus Envios</h2>
        <button className="btn btn-secondary btn-sm" type="button" onClick={carregar}>
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
          onChange={(e) => setFiltroStatus(e.target.value ? Number(e.target.value) : '')}
          style={{ width: 200 }}
        >
          <option value="">Todos Status</option>
          <option value="1">Pendente orçamento</option>
          <option value="2">Orçamento enviado</option>
          <option value="3">Análise orçamento</option>
          <option value="4">Aprovação</option>
        </select>
      </div>

      <div id="listaAcompanhamentoPA">
        {isLoading && (
          <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Carregando...</p>
        )}
        {!isLoading && filtrados.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Nenhum registro encontrado.</p>
        )}

        {filtrados.map(([protocolo, itens]) => {
          const statusAtual = Math.max(...itens.map((i) => i.status || 1));
          const dataEnvio = itens[0]?.criadoEm || '';
          return (
            <div key={protocolo} className={`protocolo-card ${abertos[protocolo] ? 'open' : ''}`}>
              <div
                className="protocolo-header"
                onClick={() => setAbertos((prev) => ({ ...prev, [protocolo]: !prev[protocolo] }))}
              >
                <div className="header-info-main">
                  <span className="header-title">{protocolo}</span>
                  <span className="header-sub">{dataEnvio}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="status-badge" style={{ background: statusCor(statusAtual) }}>{getStatusLabel(statusAtual)}</span>
                  <i className="material-icons arrow-icon">keyboard_arrow_down</i>
                </div>
              </div>
              <div className="protocolo-detalhes">
                <div className="table-scroll">
                  <table className="tabela-horizontal">
                    <thead>
                      <tr>
                        <th>Cód. Barras</th>
                        <th>Cód. GEMCO</th>
                        <th>Descrição</th>
                      <th>Fornecedor</th>
                      <th>Linha</th>
                      <th>Serial</th>
                      <th>Peças</th>
                      <th>Acess.</th>
                      <th>Mão de Obra</th>
                      <th>Embal.</th>
                      <th>Hig.</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item) => (
                      <tr key={item.id}>
                        <td>{item.codBarras}</td>
                        <td><strong>{item.codGemco}</strong></td>
                        <td>{item.descricao}</td>
                        <td>{item.fornecedor}</td>
                        <td>{item.linha}</td>
                        <td>{item.serial}</td>
                        <td>{item.valPecas != null ? item.valPecas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{item.valAcess != null ? item.valAcess.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{item.valMaoObra != null ? item.valMaoObra.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{item.valEmb != null ? item.valEmb.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{item.valHig != null ? item.valHig.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{item.totalOrcamento != null ? item.totalOrcamento.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-'}</td>
                        <td>{getStatusLabel(item.status)}</td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MeusEnvios;
