import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { getStatusLabel } from '../lib/statusMap';

type OrcamentoItem = {
  id: string;
  protocolo: string;
  cnpj?: string;
  razaoSocial?: string;
  unidade?: string;
  emailRetorno?: string;
  uuid?: string;
  codBarras?: string;
  ean?: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  status: number;
  defeitoEncontrado?: string;
  pecasDesc?: string;
  valPecas?: number;
  acessDesc?: string;
  valAcess?: number;
  valMaoObra?: number;
  valEmb?: number;
  valHig?: number;
  fotoNome?: string;
  defeitoFuncional?: string;
  garantia?: string;
  tipoOrc?: string;
};

const loadPendentes = () => {
  try {
    const saved = localStorage.getItem('gat_orc_pendentes');
    if (!saved) return [] as OrcamentoItem[];
    const parsed = JSON.parse(saved) as OrcamentoItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const savePendentes = (items: OrcamentoItem[]) => {
  try {
    localStorage.setItem('gat_orc_pendentes', JSON.stringify(items));
  } catch {
    // ignore storage errors
  }
};

const parseCurrency = (raw: string) => {
  const onlyDigits = raw.replace(/\D/g, '');
  const asNumber = Number(onlyDigits) / 100;
  return Number.isNaN(asNumber) ? 0 : asNumber;
};

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const LancarOrcamentos = () => {
  const [items, setItems] = useState<OrcamentoItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [defeitoEncontrado, setDefeitoEncontrado] = useState('');
  const [pecasDesc, setPecasDesc] = useState('');
  const [valPecas, setValPecas] = useState(0);
  const [acessDesc, setAcessDesc] = useState('');
  const [valAcess, setValAcess] = useState(0);
  const [valMaoObra, setValMaoObra] = useState(0);
  const [valEmb, setValEmb] = useState(0);
  const [valHig, setValHig] = useState(0);
  const [foto, setFoto] = useState<File | null>(null);
  const [defeitoFuncional, setDefeitoFuncional] = useState('');
  const [garantia, setGarantia] = useState('');
  const [tipoOrc, setTipoOrc] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const grupos = useMemo(() => {
    const map = new Map<string, OrcamentoItem[]>();
    items.forEach((item) => {
      const key = item.protocolo || 'SEM PROTOCOLO';
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    });
    return Array.from(map.entries());
  }, [items]);

  const getCodigoBarras = (item: OrcamentoItem) => item.ean || item.codBarras || '-';
  const isOrcado = (item: OrcamentoItem) => item.status >= 2;

  const total = useMemo(
    () => valPecas + valAcess + valMaoObra + valEmb + valHig,
    [valPecas, valAcess, valMaoObra, valEmb, valHig]
  );
  const totalPecasAcess = useMemo(() => valPecas + valAcess, [valPecas, valAcess]);
  const precisaFoto = useMemo(() => /AVARIA/i.test(defeitoEncontrado), [defeitoEncontrado]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    const loadFromApi = async () => {
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
        const res = await oracleApi.get(ORACLE_ENDPOINTS.getOrcamentosAnalise, {
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
          uuid: String(row.uuid ?? row.UUID ?? ''),
          codBarras: row.cod_barras ?? row.COD_BARRAS ?? row.codBarras ?? row.cod_barras,
          ean: row.ean ?? row.EAN ?? row.cod_barras ?? row.COD_BARRAS ?? row.codBarras,
          codGemco: String(row.cod_gemco ?? row.COD_GEMCO ?? row.codGemco ?? ''),
          descricao: String(row.descricao ?? row.DESCRICAO ?? ''),
          fornecedor: String(row.fornecedor ?? row.FORNECEDOR ?? ''),
          linha: String(row.linha ?? row.LINHA ?? ''),
          serial: String(row.serial ?? row.SERIAL ?? ''),
          status: Number(row.status ?? row.STATUS ?? 1),
          defeitoEncontrado: row.defeito_encontrado ?? row.DEFEITO_ENCONTRADO ?? row.defeitoEncontrado,
          pecasDesc: row.pecas_desc ?? row.PECAS_DESC ?? row.pecasDesc,
          valPecas: row.val_pecas ?? row.VAL_PECAS ?? row.valPecas,
          acessDesc: row.acess_desc ?? row.ACESS_DESC ?? row.acessDesc,
          valAcess: row.val_acess ?? row.VAL_ACESS ?? row.valAcess,
          valMaoObra: row.val_mao_obra ?? row.VAL_MAO_OBRA ?? row.valMaoObra,
          valEmb: row.val_emb ?? row.VAL_EMB ?? row.valEmb,
          valHig: row.val_hig ?? row.VAL_HIG ?? row.valHig,
          fotoNome: row.foto_nome ?? row.FOTO_NOME ?? row.fotoNome
        })) as OrcamentoItem[];

        setItems(normalized);
      } catch {
        setItems(loadPendentes());
      } finally {
        setIsLoading(false);
      }
    };

    loadFromApi();
  }, []);

  const selecionarItem = (item: OrcamentoItem) => {
    setSelectedId(item.id);
    setDefeitoEncontrado(item.defeitoEncontrado || '');
    setPecasDesc(item.pecasDesc || '');
    setValPecas(item.valPecas || 0);
    setAcessDesc(item.acessDesc || '');
    setValAcess(item.valAcess || 0);
    setValMaoObra(item.valMaoObra || 0);
    setValEmb(item.valEmb || 0);
    setValHig(item.valHig || 0);
    setFoto(null);
    setDefeitoFuncional('');
    setGarantia('');
    setTipoOrc('');
  };

  const salvarOrcamento = async () => {
    if (!selected) return;
    try {
      const totalOrcamento = valPecas + valAcess + valMaoObra + valEmb + valHig;
      let cnpj = selected.cnpj || '';
      let razaoSocial = selected.razaoSocial || '';
      let unidade = selected.unidade || '';
      let emailRetorno = selected.emailRetorno || '';

      try {
        const profileRaw = localStorage.getItem('gat_user_profile');
        if (profileRaw) {
          const profile = JSON.parse(profileRaw) as {
            cnpj?: string;
            razao_social?: string;
            email?: string;
            unidade?: string;
          };
          if (!cnpj && profile.cnpj) cnpj = profile.cnpj;
          if (!razaoSocial && profile.razao_social) razaoSocial = profile.razao_social;
          if (!emailRetorno && profile.email) emailRetorno = profile.email;
          if (!unidade && profile.unidade) unidade = profile.unidade;
        }
      } catch {
        // ignore profile parsing
      }

      const payload = {
        protocolo: selected.protocolo,
        paUsuario: localStorage.getItem('gat_user') || '',
        cnpj,
        razaoSocial,
        unidade,
        emailRetorno,
        itens: [
          {
            protocolo: selected.protocolo,
            uuid: selected.uuid,
            codBarras: getCodigoBarras(selected),
            codGemco: selected.codGemco,
            descricao: selected.descricao,
            fornecedor: selected.fornecedor,
            linha: selected.linha,
            serial: selected.serial,
            defeitoEncontrado,
            fotoNome: foto?.name || selected.fotoNome || '',
            pecasDesc,
            valPecas,
            acessDesc,
            valAcess,
            valMaoObra,
            valEmb,
            valHig,
            totalOrcamento,
            defeitoFuncional,
            garantia,
            tipoOrc,
            status: 2
          }
        ]
      };

      await oracleApi.post(ORACLE_ENDPOINTS.postOrcamentoFinal, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const updated = items.map((item) => {
        if (item.id !== selected.id) return item;
        return {
          ...item,
          defeitoEncontrado,
          pecasDesc,
          valPecas,
          acessDesc,
          valAcess,
          valMaoObra,
          valEmb,
          valHig,
          fotoNome: foto?.name || item.fotoNome,
          defeitoFuncional,
          garantia,
          tipoOrc,
          status: 2
        };
      });
      setItems(updated);
      savePendentes(updated);
      // limpa o formul�rio ap�s envio
      setSelectedId(null);
      setDefeitoEncontrado('');
      setPecasDesc('');
      setValPecas(0);
      setAcessDesc('');
      setValAcess(0);
      setValMaoObra(0);
      setValEmb(0);
      setValHig(0);
      setFoto(null);
      setDefeitoFuncional('');
      setGarantia('');
      setTipoOrc('');
      setToast({ type: 'success', message: 'Orçamento enviado com sucesso.' });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const data = err.response?.data;
        setToast({ type: 'error', message: `Erro ao enviar (${status ?? 'sem status'}).` });
        console.error('Erro ao enviar orçamento final:', status, data);
      } else {
        setToast({ type: 'error', message: 'Erro ao enviar orçamento final.' });
        console.error('Erro ao enviar orçamento final:', err);
      }
    }
  };

  return (
    <div className="view-section">
      <h2 className="page-title">Lançamento de Orçamentos</h2>

      <div className="card">
        <div className="section-title">Lotes (Protocolos)</div>
        {isLoading && (
          <div style={{ color: '#999', textAlign: 'center', padding: '10px 0' }}>Carregando...</div>
        )}
        {!isLoading && items.length === 0 && (
          <div style={{ color: '#999', textAlign: 'center', padding: '10px 0' }}>Nenhum item pendente.</div>
        )}
        {grupos.map(([protocolo, itens]) => (
          <div key={protocolo} className="protocolo-card open">
            <div className="protocolo-header">
              <span className="header-title">{protocolo}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{itens.length} itens</span>
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
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => selecionarItem(item)}
                        style={{ cursor: 'pointer', background: item.id === selectedId ? '#fff3cd' : undefined }}
                      >
                        <td>{getCodigoBarras(item)}</td>
                        <td><strong>{item.codGemco}</strong></td>
                        <td>{item.descricao}</td>
                        <td>{item.fornecedor}</td>
                        <td>{item.linha}</td>
                        <td>{item.serial}</td>
                        <td>{isOrcado(item) ? '✓' : ''} {getStatusLabel(item.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="section-title">Valores e Defeitos</div>
        {!selected && (
          <div style={{ color: '#777', padding: '10px 0' }}>
            Selecione um item pendente acima para lançar o orçamento.
          </div>
        )}
        {selected && (
          <div className="grid-form">
            <div className="span-12">
              <label>Defeito Encontrado</label>
              <select value={defeitoEncontrado} onChange={(e) => setDefeitoEncontrado(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="EMBALAGEM | HIGIENIZAÇÃO | MÃO DE OBRA">EMBALAGEM | HIGIENIZAÇÃO | MÃO DE OBRA</option>
                <option value="DEFEITO FUNCIONAL | AVARIA ESTÉTICA">DEFEITO FUNCIONAL | AVARIA ESTÉTICA</option>
                <option value="AVARIA ESTÉTICA">AVARIA ESTÉTICA</option>
                <option value="DEFEITO FUNCIONAL">DEFEITO FUNCIONAL</option>
              </select>
              {precisaFoto && (
                <div style={{ marginTop: 5 }}>
                  <label style={{ color: 'var(--azul)' }}>📸 Foto da Avaria (Obrigatório)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFoto(e.target.files?.[0] || null)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
            <div className="span-2">
              <label>Possui Defeito Funcional?</label>
              <select value={defeitoFuncional} onChange={(e) => setDefeitoFuncional(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="SIM">SIM</option>
                <option value="NÃO">NÃO</option>
              </select>
            </div>
            <div className="span-2">
              <label>Dentro do Prazo de Garantia?</label>
              <select value={garantia} onChange={(e) => setGarantia(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="SIM">SIM</option>
                <option value="NÃO">NÃO</option>
              </select>
            </div>
            <div className="span-4">
              <label>Tipo Orc.</label>
              <select value={tipoOrc} onChange={(e) => setTipoOrc(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="SALDO A">SALDO A</option>
                <option value="NOVO">NOVO</option>
                <option value="SUCATA">SUCATA</option>
              </select>
            </div>

            <div className="span-4">
              <label>Peças Avariadas/Faltantes</label>
              <input type="text" value={pecasDesc} onChange={(e) => setPecasDesc(e.target.value)} placeholder="Busca..." />
            </div>
            <div className="span-2">
              <label>Valor Peças</label>
              <input type="text" inputMode="decimal" value={formatCurrency(valPecas)} onChange={(e) => setValPecas(parseCurrency(e.target.value))} />
            </div>
            <div className="span-4">
              <label>Acessórios Avariados/Faltantes</label>
              <input type="text" value={acessDesc} onChange={(e) => setAcessDesc(e.target.value)} placeholder="Busca..." />
            </div>
            <div className="span-2">
              <label>Valor Acessórios</label>
              <input type="text" inputMode="decimal" value={formatCurrency(valAcess)} onChange={(e) => setValAcess(parseCurrency(e.target.value))} />
            </div>

            <div className="span-4"><label>Mão de Obra</label><input type="text" inputMode="decimal" value={formatCurrency(valMaoObra)} onChange={(e) => setValMaoObra(parseCurrency(e.target.value))} /></div>
            <div className="span-4"><label>Embalagem</label><input type="text" inputMode="decimal" value={formatCurrency(valEmb)} onChange={(e) => setValEmb(parseCurrency(e.target.value))} /></div>
            <div className="span-4"><label>Higienização</label><input type="text" inputMode="decimal" value={formatCurrency(valHig)} onChange={(e) => setValHig(parseCurrency(e.target.value))} /></div>

            <div className="span-6"><label>Valor Final Peças/Acessórios</label><input type="text" readOnly value={formatCurrency(totalPecasAcess)} style={{ textAlign: 'right' }} /></div>
            <div className="span-6"><label>Total do Orçamento</label><input type="text" readOnly value={formatCurrency(total)} className="total-display" /></div>
          </div>
        )}
        {selected && (
          <div className="action-bar">
            <button className="btn btn-success btn-sm" type="button" onClick={salvarOrcamento}>
              <i className="material-icons">save</i> SALVAR ORÇAMENTO
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}>
            <div className="toast-title">{toast.type === 'success' ? 'Sucesso' : 'Erro'}</div>
            <div className="toast-message">{toast.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LancarOrcamentos;


