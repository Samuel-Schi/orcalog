import { useEffect, useMemo, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { getStatusLabel } from '../lib/statusMap';

type RomaneioItem = {
  id: string;
  protocolo: string;
  cnpj?: string;
  razaoSocial?: string;
  unidade?: string;
  emailRetorno?: string;
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
  defeitoEncontrado?: string;
  pecasDesc?: string;
  acessDesc?: string;
};

const formatMoney = (value?: number) =>
  value != null ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

const formatDateTime = (value?: string) => {
  if (!value) return 'Sem data informada';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('pt-BR');
};

const Romaneio = () => {
  const [items, setItems] = useState<RomaneioItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [selectedProtocolo, setSelectedProtocolo] = useState<string | null>(null);

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
        cnpj: String(row.cnpj ?? row.CNPJ ?? ''),
        razaoSocial: String(row.razao_social ?? row.RAZAO_SOCIAL ?? row.razaoSocial ?? ''),
        unidade: String(row.unidade ?? row.UNIDADE ?? ''),
        emailRetorno: String(row.email_retorno ?? row.EMAIL_RETORNO ?? row.emailRetorno ?? ''),
        codBarras: String(row.cod_barras ?? row.COD_BARRAS ?? row.codBarras ?? ''),
        codGemco: String(row.cod_gemco ?? row.COD_GEMCO ?? row.codGemco ?? ''),
        descricao: String(row.descricao ?? row.DESCRICAO ?? ''),
        fornecedor: String(row.fornecedor ?? row.FORNECEDOR ?? ''),
        linha: String(row.linha ?? row.LINHA ?? ''),
        serial: String(row.serial ?? row.SERIAL ?? ''),
        status: Number(row.status ?? row.STATUS ?? 1),
        criadoEm: String(row.criado_em ?? row.CRIADO_EM ?? ''),
        totalOrcamento: row.total_orcamento ?? row.TOTAL_ORCAMENTO ?? row.totalOrcamento,
        valPecas: row.val_pecas ?? row.VAL_PECAS ?? row.valPecas,
        valAcess: row.val_acess ?? row.VAL_ACESS ?? row.valAcess,
        valMaoObra: row.val_mao_obra ?? row.VAL_MAO_OBRA ?? row.valMaoObra,
        valEmb: row.val_emb ?? row.VAL_EMB ?? row.valEmb,
        valHig: row.val_hig ?? row.VAL_HIG ?? row.valHig,
        defeitoEncontrado: row.defeito_encontrado ?? row.DEFEITO_ENCONTRADO ?? row.defeitoEncontrado,
        pecasDesc: row.pecas_desc ?? row.PECAS_DESC ?? row.pecasDesc,
        acessDesc: row.acess_desc ?? row.ACESS_DESC ?? row.acessDesc
      })) as RomaneioItem[];

      setItems(normalized);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    const resetPrint = () => setSelectedProtocolo(null);
    window.addEventListener('afterprint', resetPrint);
    return () => window.removeEventListener('afterprint', resetPrint);
  }, []);

  const grupos = useMemo(() => {
    const map = new Map<string, RomaneioItem[]>();
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
      if (!termo) return true;
      const first = itens[0];
      return (
        protocolo.toLowerCase().includes(termo) ||
        (first?.razaoSocial || '').toLowerCase().includes(termo) ||
        (first?.codGemco || '').toLowerCase().includes(termo)
      );
    });
  }, [filtroTexto, grupos]);

  const imprimir = (protocolo: string) => {
    setSelectedProtocolo(protocolo);
    window.setTimeout(() => {
      window.print();
    }, 120);
  };

  return (
    <div className="view-section romaneio-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <h2 className="page-title" style={{ marginBottom: 0, paddingBottom: 5, fontSize: '1.1rem', borderBottom: 'none' }}>
          Romaneio
        </h2>
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
          placeholder="Buscar por protocolo, razão social ou GEMCO..."
          className="search-input"
        />
      </div>

      {isLoading && (
        <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Carregando...</p>
      )}

      {!isLoading && filtrados.length === 0 && (
        <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Nenhum romaneio disponível.</p>
      )}

      <div className="romaneio-list">
        {filtrados.map(([protocolo, itens]) => {
          const first = itens[0];
          const totalProtocolo = itens.reduce((acc, item) => acc + Number(item.totalOrcamento || 0), 0);
          const printMode = selectedProtocolo === protocolo;

          return (
            <section
              key={protocolo}
              className={`card romaneio-print-root ${printMode ? 'romaneio-print-active' : ''}`}
            >
              <div className="romaneio-toolbar no-print">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => imprimir(protocolo)}>
                  <i className="material-icons">print</i>
                  Imprimir Romaneio
                </button>
              </div>

              <div className="romaneio-sheet">
                <div className="romaneio-header">
                  <div>
                    <div className="romaneio-kicker">Devolução / Romaneio</div>
                    <h3>Protocolo {protocolo}</h3>
                    <p>{formatDateTime(first?.criadoEm)}</p>
                  </div>
                  <div className="romaneio-meta">
                    <div><strong>Status:</strong> {getStatusLabel(Math.max(...itens.map((item) => item.status || 1)))}</div>
                    <div><strong>Total do lote:</strong> {formatMoney(totalProtocolo)}</div>
                    <div><strong>Itens:</strong> {itens.length}</div>
                  </div>
                </div>

                <div className="romaneio-grid">
                  <div className="romaneio-info-card">
                    <span className="romaneio-label">Razão Social</span>
                    <strong>{first?.razaoSocial || '-'}</strong>
                  </div>
                  <div className="romaneio-info-card">
                    <span className="romaneio-label">CNPJ</span>
                    <strong>{first?.cnpj || '-'}</strong>
                  </div>
                  <div className="romaneio-info-card">
                    <span className="romaneio-label">Unidade</span>
                    <strong>{first?.unidade || '-'}</strong>
                  </div>
                  <div className="romaneio-info-card">
                    <span className="romaneio-label">E-mail de Retorno</span>
                    <strong>{first?.emailRetorno || '-'}</strong>
                  </div>
                </div>

                <div className="table-scroll">
                  <table className="tabela-horizontal romaneio-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Identificação</th>
                        <th>Defeito</th>
                        <th>Peças / Acessórios</th>
                        <th>Serviços</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.descricao || '-'}</strong>
                            <div>{item.fornecedor || '-'}</div>
                            <div>{item.linha || '-'}</div>
                          </td>
                          <td>
                            <div><strong>Cód. Barras:</strong> {item.codBarras || '-'}</div>
                            <div><strong>GEMCO:</strong> {item.codGemco || '-'}</div>
                            <div><strong>Serial:</strong> {item.serial || '-'}</div>
                          </td>
                          <td>{item.defeitoEncontrado || '-'}</td>
                          <td>
                            <div><strong>Peças:</strong> {item.pecasDesc || '-'}</div>
                            <div>{formatMoney(item.valPecas)}</div>
                            <div style={{ marginTop: 6 }}><strong>Acessórios:</strong> {item.acessDesc || '-'}</div>
                            <div>{formatMoney(item.valAcess)}</div>
                          </td>
                          <td>
                            <div><strong>Mão de Obra:</strong> {formatMoney(item.valMaoObra)}</div>
                            <div><strong>Embalagem:</strong> {formatMoney(item.valEmb)}</div>
                            <div><strong>Higienização:</strong> {formatMoney(item.valHig)}</div>
                          </td>
                          <td>{formatMoney(item.totalOrcamento)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="romaneio-footer">
                  <div className="romaneio-signature">
                    <span>Recebido por</span>
                  </div>
                  <div className="romaneio-signature">
                    <span>Conferência / Devolução</span>
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default Romaneio;
