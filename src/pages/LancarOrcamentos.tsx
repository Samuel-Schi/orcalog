import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { getStatusLabel } from '../lib/statusMap';

type OrcamentoItem = {
  id: string;
  dbId?: number;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [scanValue, setScanValue] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const scanVideoRef = useRef<HTMLVideoElement | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);

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
  const normalizeCode = (value: string) => value.replace(/\D/g, '').trim();

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
    if (!isScanning) return;
    let cancelled = false;

    const start = async () => {
      try {
        setScanError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        scanStreamRef.current = stream;
        if (scanVideoRef.current) {
          scanVideoRef.current.srcObject = stream;
          await scanVideoRef.current.play();
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setScanError('Leitor nao suportado neste navegador. Use o campo de bip.');
          return;
        }

        const detector = new BarcodeDetectorCtor({
          formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code']
        });

        const scan = async () => {
          if (cancelled || !scanVideoRef.current) return;
          try {
            const barcodes = await detector.detect(scanVideoRef.current);
            if (barcodes && barcodes.length > 0) {
              const value = barcodes[0].rawValue || '';
              if (value) {
                handleScan(value);
                setIsScanning(false);
                return;
              }
            }
          } catch {
            // ignore scan errors
          }
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      } catch {
        setScanError('Nao foi possivel acessar a camera.');
      }
    };

    start();

    return () => {
      cancelled = true;
      if (scanStreamRef.current) {
        scanStreamRef.current.getTracks().forEach((t) => t.stop());
        scanStreamRef.current = null;
      }
    };
  }, [isScanning]);

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
          dbId: (() => {
            const rawId = row.id ?? row.ID;
            if (rawId === null || rawId === undefined || rawId === '') return undefined;
            const parsed = Number(rawId);
            return Number.isFinite(parsed) ? parsed : undefined;
          })(),
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
          fotoNome: row.foto_nome ?? row.FOTO_NOME ?? row.fotoNome,
          defeitoFuncional: row.defeito_funcional ?? row.DEFEITO_FUNCIONAL ?? row.defeitoFuncional,
          garantia: row.garantia ?? row.GARANTIA ?? row.garantiaPrazo,
          tipoOrc: row.tipo_orc ?? row.TIPO_ORC ?? row.tipoOrc
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

  const findByCode = (raw: string) => {
    const norm = normalizeCode(raw);
    if (!norm) return null;
    return items.find((item) => {
      const codigo = normalizeCode(getCodigoBarras(item));
      const gemco = normalizeCode(item.codGemco || '');
      const serial = normalizeCode(item.serial || '');
      return codigo === norm || gemco === norm || serial === norm;
    }) || null;
  };

  const handleScan = (raw: string) => {
    const cleaned = raw.trim();
    setScanValue(cleaned);
    const found = findByCode(cleaned);
    if (found) {
      selecionarItem(found);
      setToast({ type: 'success', message: 'Item localizado pelo codigo.' });
    } else {
      setToast({ type: 'error', message: 'Codigo nao encontrado nos itens.' });
    }
  };

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
    setDefeitoFuncional(item.defeitoFuncional || '');
    setGarantia(item.garantia || '');
    setTipoOrc(item.tipoOrc || '');
  };

  const lancarValores = async () => {
    if (!selected) return;
    if (selected.dbId == null) {
      setToast({ type: 'error', message: 'Este item nao possui ID real do banco. Ajuste o endpoint get_orcamentos_analise para retornar o campo ID.' });
      return;
    }
    if (precisaFoto && !foto && !selected.fotoNome) {
      setToast({ type: 'error', message: 'Anexe a foto da avaria antes de lancar os valores.' });
      return;
    }

    try {
      setIsSubmitting(true);
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
        id: selected.dbId,
        itemId: selected.dbId,
        protocolo: selected.protocolo,
        paUsuario: localStorage.getItem('gat_user') || '',
        cnpj,
        razaoSocial,
        unidade,
        emailRetorno,
        itens: [
          {
            id: selected.dbId,
            itemId: selected.dbId,
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

      await oracleApi.post(ORACLE_ENDPOINTS.updateValores, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      await oracleApi.post(ORACLE_ENDPOINTS.syncOrcamentoSupabase, payload, {
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
      // limpa o formulario apos envio
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
      setToast({ type: 'success', message: 'Valores lancados com sucesso.' });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const data = err.response?.data;
        const backendError =
          data?.error ||
          data?.message ||
          data?.hint ||
          `Erro ao lancar valores (${status ?? 'sem status'}).`;
        setToast({ type: 'error', message: String(backendError) });
        console.error('Erro ao lancar valores do orcamento:', status, data);
      } else {
        setToast({ type: 'error', message: 'Erro ao lancar valores do orcamento.' });
        console.error('Erro ao lancar valores do orcamento:', err);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="view-section">
      <h2 className="page-title">Lancamento de Orcamentos</h2>

      <div className="card">
        <div className="section-title">Lotes (Protocolos)</div>
        {items.length > 0 && (
          <div className="scan-bar">
            <div className="scan-input">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Bipar ou digitar codigo de barras/GEMCO"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleScan(scanValue);
                  }
                }}
              />
            </div>
            <div className="scan-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleScan(scanValue)}>
                Buscar
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={() => setIsScanning(true)}>
                Bip Camera
              </button>
            </div>
          </div>
        )}
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
                      <th>Cod. Barras</th>
                      <th>Cod. GEMCO</th>
                      <th>Descricao</th>
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
                        <td>{isOrcado(item) ? 'OK' : ''} {getStatusLabel(item.status)}</td>
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
            Selecione um item pendente acima para lancar o orcamento.
          </div>
        )}
        {selected && (
          <div className="grid-form">
            <div className="span-12">
              <label>Defeito Encontrado</label>
              <select value={defeitoEncontrado} onChange={(e) => setDefeitoEncontrado(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="EMBALAGEM | HIGIENIZACAO | MAO DE OBRA">EMBALAGEM | HIGIENIZACAO | MAO DE OBRA</option>
                <option value="DEFEITO FUNCIONAL | AVARIA ESTETICA">DEFEITO FUNCIONAL | AVARIA ESTETICA</option>
                <option value="AVARIA ESTETICA">AVARIA ESTETICA</option>
                <option value="DEFEITO FUNCIONAL">DEFEITO FUNCIONAL</option>
              </select>
              {precisaFoto && (
                <div style={{ marginTop: 5 }}>
                  <label style={{ color: 'var(--azul)' }}>Foto da avaria (obrigatorio)</label>
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
                <option value="NAO">NAO</option>
              </select>
            </div>
            <div className="span-2">
              <label>Dentro do Prazo de Garantia?</label>
              <select value={garantia} onChange={(e) => setGarantia(e.target.value)}>
                <option value="">SELECIONE...</option>
                <option value="SIM">SIM</option>
                <option value="NAO">NAO</option>
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
              <label>Pecas Avariadas/Faltantes</label>
              <input type="text" value={pecasDesc} onChange={(e) => setPecasDesc(e.target.value)} placeholder="Busca..." />
            </div>
            <div className="span-2">
              <label>Valor Pecas</label>
              <input type="text" inputMode="decimal" value={formatCurrency(valPecas)} onChange={(e) => setValPecas(parseCurrency(e.target.value))} />
            </div>
            <div className="span-4">
              <label>Acessorios Avariados/Faltantes</label>
              <input type="text" value={acessDesc} onChange={(e) => setAcessDesc(e.target.value)} placeholder="Busca..." />
            </div>
            <div className="span-2">
              <label>Valor Acessorios</label>
              <input type="text" inputMode="decimal" value={formatCurrency(valAcess)} onChange={(e) => setValAcess(parseCurrency(e.target.value))} />
            </div>

            <div className="span-4"><label>Mao de Obra</label><input type="text" inputMode="decimal" value={formatCurrency(valMaoObra)} onChange={(e) => setValMaoObra(parseCurrency(e.target.value))} /></div>
            <div className="span-4"><label>Embalagem</label><input type="text" inputMode="decimal" value={formatCurrency(valEmb)} onChange={(e) => setValEmb(parseCurrency(e.target.value))} /></div>
            <div className="span-4"><label>Higienizacao</label><input type="text" inputMode="decimal" value={formatCurrency(valHig)} onChange={(e) => setValHig(parseCurrency(e.target.value))} /></div>

            <div className="span-6"><label>Valor Final Pecas/Acessorios</label><input type="text" readOnly value={formatCurrency(totalPecasAcess)} style={{ textAlign: 'right' }} /></div>
            <div className="span-6"><label>Total do Orcamento</label><input type="text" readOnly value={formatCurrency(total)} className="total-display" /></div>
          </div>
        )}
        {selected && (
          <div className="action-bar">
            <button className="btn btn-success btn-sm" type="button" onClick={lancarValores} disabled={isSubmitting}>
              <i className="material-icons">save</i> {isSubmitting ? 'LANCANDO...' : 'LANCAR VALORES'}
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


      {isScanning && (
        <div className="qr-modal">
          <div className="qr-modal-content">
            <div className="qr-modal-header">
              <h3>Bip por Camera</h3>
              <button type="button" className="qr-close" onClick={() => setIsScanning(false)}>x</button>
            </div>
            <div className="qr-video-wrap">
              <video ref={scanVideoRef} className="qr-video" muted playsInline />
            </div>
            {scanError && <div className="qr-error">{scanError}</div>}
            <div className="qr-help">Aponte a camera para o codigo de barras.</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LancarOrcamentos;


