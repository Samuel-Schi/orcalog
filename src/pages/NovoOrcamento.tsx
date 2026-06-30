import { useEffect, useMemo, useRef, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

type Item = {
  id: string;
  protocolo: string;
  uuid: string;
  ean: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  status: number;
};

const NovoOrcamento = () => {
  const [protocolo, setProtocolo] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [unidade, setUnidade] = useState('');
  const [uuid, setUuid] = useState('');
  const [ean, setEan] = useState('');
  const [codGemco, setCodGemco] = useState('');
  const [descProd, setDescProd] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [linha, setLinha] = useState('');
  const [serial, setSerial] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrError, setQrError] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestSeqRef = useRef(0);

  const gerarProtocolo = () => {
    const now = new Date();
    return `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  useEffect(() => {
    setProtocolo(gerarProtocolo());

    const loadUserInfo = async () => {
      try {
        const profileRaw = localStorage.getItem('gat_user_profile');
        if (profileRaw) {
          try {
            const profile = JSON.parse(profileRaw) as {
              cnpj?: string;
              razao_social?: string;
              email?: string;
              unidade?: string;
            };
            if (profile.cnpj) setCnpj(String(profile.cnpj));
            if (profile.razao_social) setRazaoSocial(String(profile.razao_social));
            if (profile.email) setEmail(String(profile.email));
            if (profile.unidade) setUnidade(String(profile.unidade));
          } catch {
            // ignore profile parsing
          }
        }

        const usuario = (localStorage.getItem('gat_user') || '').toLowerCase();
        if (!usuario) return;

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

        const getField = (source: any, keys: string[]) => {
          if (!source || typeof source !== 'object') return '';
          const lowerMap = new Map<string, string>();
          Object.keys(source).forEach((k) => lowerMap.set(k.toLowerCase(), k));
          for (const key of keys) {
            const realKey = lowerMap.get(key.toLowerCase());
            if (realKey && source[realKey] !== null && source[realKey] !== undefined && source[realKey] !== '') {
              return String(source[realKey]);
            }
          }
          return '';
        };

        const fetchedCnpj = getField(item, ['cnpj', 'cpf_cnpj', 'documento']);
        const fetchedRazao = getField(item, ['razao_social', 'razao', 'nome', 'nome_fantasia']);
        const fetchedEmail = getField(item, ['email', 'e_mail', 'mail']);
        const fetchedUnidade = getField(item, ['unidade', 'cd_unidade', 'codigo_unidade']);

        if (fetchedCnpj) setCnpj(fetchedCnpj);
        if (fetchedRazao) setRazaoSocial(fetchedRazao);
        if (fetchedEmail) setEmail(fetchedEmail);
        if (fetchedUnidade) setUnidade(fetchedUnidade);
      } catch {
        // silencioso: mantém valores locais
      }
    };

    loadUserInfo();
  }, []);

  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;

    const start = async () => {
      try {
        setQrError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setQrError('Leitor não suportado neste navegador. Use colar o QR no campo.');
          return;
        }

        const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes && barcodes.length > 0) {
              const value = barcodes[0].rawValue || '';
              if (value) {
                handleQrInput(value);
                setShowQr(false);
                return;
              }
            }
          } catch {
            // ignore scan errors
          }
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      } catch (err) {
        setQrError('Não foi possível acessar a câmera.');
      }
    };

    start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [showQr]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    if (!codGemco) return;
    if (codGemco.trim().startsWith('{')) return;
    const handle = setTimeout(() => {
      buscarProdutoCadastro();
    }, 300);
    return () => clearTimeout(handle);
  }, [codGemco]);

  const parseQrPayload = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const data = JSON.parse(trimmed);
      const uuid = data?.uuid ?? data?.UUID ?? data?.Uuid;
      const legacyId = data?.legacyId ?? data?.LEGACYID ?? data?.legacy_id;
      const eanValue = data?.ean ?? data?.EAN ?? data?.codigo_barra ?? data?.cod_barra ?? data?.codBarra;
      return {
        uuid: uuid ? String(uuid) : '',
        legacyId: legacyId ? String(legacyId) : '',
        ean: eanValue ? String(eanValue) : '',
        raw: data
      };
    } catch {
      return null;
    }
  };

  const normalizeCode = (value: string) => value.replace(/-/g, '').trim();

  const handleQrInput = (raw: string) => {
    const parsed = parseQrPayload(raw);
    if (!parsed) return;
    if (parsed.uuid) setUuid(parsed.uuid);
    if (parsed.ean) setEan(normalizeCode(parsed.ean));
    if (parsed.legacyId) setCodGemco(normalizeCode(parsed.legacyId));
  };

  const abrirLeitorQr = () => { setShowQr(true); };

  const adicionarItem = (override?: {
    uuid?: string;
    ean?: string;
    codGemco?: string;
    descricao?: string;
    fornecedor?: string;
    linha?: string;
    serial?: string;
  }) => {
    const finalUuid = override?.uuid ?? uuid;
    const finalEan = override?.ean ?? ean;
    const finalCodGemco = override?.codGemco ?? codGemco;
    const finalDesc = override?.descricao ?? descProd;
    const finalFornecedor = override?.fornecedor ?? fornecedor;
    const finalLinha = override?.linha ?? linha;
    const finalSerial = override?.serial ?? serial;

    if (!finalCodGemco || !finalDesc) return;
    const item: Item = {
      id: criarId(),
      protocolo,
      uuid: finalUuid || '-',
      ean: finalEan || '-',
      codGemco: finalCodGemco || '-',
      descricao: finalDesc || 'Sem descrição',
      fornecedor: finalFornecedor || '-',
      linha: finalLinha || '-',
      serial: finalSerial || '-',
      status: 1
    };
    setItens((prev) => [...prev, item]);
    try {
      const saved = localStorage.getItem('gat_orc_pendentes');
      const parsed = saved ? JSON.parse(saved) as Item[] : [];
      localStorage.setItem('gat_orc_pendentes', JSON.stringify([...parsed, item]));
    } catch {
      // ignore storage errors
    }
    setCodGemco('');
    setUuid('');
    setEan('');
    setDescProd('');
    setFornecedor('');
    setLinha('');
    setSerial('');
  };

  const buscarProdutoCadastro = async () => {
    try {
      if (!codGemco) return;
      const requestId = ++requestSeqRef.current;
      setDescProd('');
      setFornecedor('');
      setLinha('');
      const lookupItem = normalizeCode(codGemco);
      const lookupEan = normalizeCode(ean || codGemco);
      const res = await oracleApi.get(ORACLE_ENDPOINTS.getProdutoCadastro, {
        params: {
          item: lookupItem,
          codigo_barra: lookupEan,
          _ts: Date.now()
        },
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

      if (requestId !== requestSeqRef.current) return;

      const item = list[0] ?? data ?? {};
      const getField = (source: any, keys: string[]) => {
        if (!source || typeof source !== 'object') return '';
        const lowerMap = new Map<string, string>();
        Object.keys(source).forEach((k) => lowerMap.set(k.toLowerCase(), k));
        for (const key of keys) {
          const realKey = lowerMap.get(key.toLowerCase());
          if (realKey && source[realKey] !== null && source[realKey] !== undefined && source[realKey] !== '') {
            return String(source[realKey]);
          }
        }
        return '';
      };

      const fetchedItem = getField(item, ['item', 'cod_gemco', 'codigo', 'cod_item', 'item_codigo']);
      const descricao = getField(item, ['descricao', 'ds_produto', 'descricao_produto', 'produto']);
      const fornecedorApi = getField(item, ['fornecedor', 'ds_fornecedor', 'desc_fornecedor', 'fornecedor_desc', 'nome_fornecedor']);
      const linhaApi = getField(item, ['linha', 'ds_linha', 'desc_linha', 'linha_desc', 'nome_linha']);
      const familiaApi = item.familia ?? item.FAMILIA ?? '';
      const voltagemApi = item.voltagem ?? item.VOLTAGEM ?? '';
      const volumesApi = item.volumes ?? item.VOLUMES ?? '';
      if (descricao) setDescProd(descricao);
      if (fetchedItem) setCodGemco(String(fetchedItem));
      if (fornecedorApi) setFornecedor(String(fornecedorApi));
      if (linhaApi) setLinha(String(linhaApi));
      if (familiaApi) setFamilia(String(familiaApi));
      if (voltagemApi) setVoltagem(String(voltagemApi));
      if (volumesApi) setVolumes(String(volumesApi));

      if (descricao) {
        adicionarItem({
          uuid,
          ean: lookupEan,
          codGemco: fetchedItem || lookupItem,
          descricao,
          fornecedor: fornecedorApi || '',
          linha: linhaApi || '',
          serial
        });
      }
    } catch {
      // silencioso
    }
  };

  const criarId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID())
      || `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  const removerItem = (id: string) => setItens((prev) => prev.filter((item) => item.id !== id));

  const finalizarEnvio = async () => {
    if (itens.length === 0 || isSaving) return;
    if (!unidade.trim()) {
      setToast({ type: 'error', message: 'Preencha a filial (unidade) para enviar.' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        protocolo,
        paUsuario: localStorage.getItem('gat_user') || '',
        cnpj,
        razaoSocial,
        unidade,
        emailRetorno: email,
        itens: itens.map((item) => ({
          protocolo: item.protocolo,
          uuid: item.uuid,
          ean: item.ean,
          codBarras: item.ean,
          codGemco: item.codGemco,
          descricao: item.descricao,
          fornecedor: item.fornecedor,
          linha: item.linha,
          serial: item.serial,
          status: item.status
        }))
      };

      await oracleApi.post(ORACLE_ENDPOINTS.saveOrcamento, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      setToast({ type: 'success', message: 'Envio realizado com sucesso.' });
      const protocoloAnterior = protocolo;
      setItens([]);
      setCodGemco('');
      setUuid('');
      setEan('');
      setDescProd('');
      setFornecedor('');
      setLinha('');
      setSerial('');
      setProtocolo(gerarProtocolo());
      try {
        const saved = localStorage.getItem('gat_orc_pendentes');
        const parsed = saved ? JSON.parse(saved) as Item[] : [];
        const filtered = parsed.filter((item) => item.protocolo !== protocoloAnterior);
        localStorage.setItem('gat_orc_pendentes', JSON.stringify(filtered));
      } catch {
        // ignore storage errors
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Não foi possível enviar. Tente novamente.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id="viewNovoOrcamento" className="view-section">
      <h2 className="page-title">Novo Orçamento</h2>

      <div className="card">
        <div className="grid-form">
          <div className="span-2"><label>Protocolo</label><input type="text" value={protocolo} readOnly /></div>
          <div className="span-3"><label>P.A.</label><input type="text" value={localStorage.getItem('gat_user') || ''} readOnly /></div>
          <div className="span-2"><label>CNPJ</label><input type="text" value={formatCnpj(cnpj)} readOnly /></div>
          <div className="span-2"><label>Razão Social</label><input type="text" value={razaoSocial} readOnly /></div>
          <div className="span-3"><label>Email Retorno</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="grid-form" style={{ marginTop: 10 }}>
          <div className="span-3"><label>Unidade</label><input type="text" value={unidade} onChange={(e) => setUnidade(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Dados do Produto</div>
        <div className="grid-form">
          <div className="span-2">
            <label>Código</label>
            <div className="qr-input-group">
              <input
                type="text"
                value={codGemco}
                onChange={(e) => {
                  const value = e.target.value;
                  setCodGemco(value);
                  const trimmed = value.trim();
                  if (trimmed.startsWith('{') || trimmed.includes('"legacyId"') || trimmed.includes('"uuid"') || trimmed.includes('"ean"')) {
                    handleQrInput(value);
                  } else {
                    const normalized = normalizeCode(value);
                    setCodGemco(normalized);
                    if (normalized.length >= 8) {
                      setEan(normalized);
                    } else {
                      setEan('');
                    }
                  }
                }}
                onBlur={(e) => handleQrInput(e.target.value)}
              />
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={abrirLeitorQr}
                title="Ler QR Code"
                style={{ padding: '0 10px', whiteSpace: 'nowrap' }}
              >
                QR
              </button>
            </div>
          </div>
          <div className="span-2"><label>UUID</label><input type="text" value={uuid} readOnly /></div>
          <div className="span-2"><label>Código de Barras</label><input type="text" value={ean} readOnly /></div>
          <div className="span-6"><label>Descrição</label><input type="text" value={descProd} readOnly /></div>
          <div className="span-2"><label>Fornecedor</label><input type="text" value={fornecedor} readOnly /></div>
          <div className="span-2"><label>Linha</label><input type="text" value={linha} readOnly /></div>
          <div className="span-2"><label>Serial</label><input type="text" value={serial} onChange={(e) => setSerial(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
      <div className="section-title">Itens neste Protocolo</div>
        <div className="table-scroll">
          <table className="tabela-horizontal">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>UUID</th>
                <th>Cód. Barras</th>
                <th>Cód. GEMCO</th>
                <th>Descrição</th>
                <th>Fornecedor</th>
                <th>Linha</th>
                <th>Serial</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: '#999' }}>Nenhum item adicionado.</td>
                </tr>
              )}
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>{protocolo}</td>
                  <td>{item.uuid}</td>
                  <td>{item.ean}</td>
                  <td><strong>{item.codGemco}</strong></td>
                  <td>{item.descricao}</td>
                  <td>{item.fornecedor}</td>
                  <td>{item.linha}</td>
                  <td>{item.serial}</td>
                  <td>{item.status}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => removerItem(item.id)}>
                      <i className="material-icons">delete</i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="action-bar" style={{ marginTop: 20 }}>
          <button className="btn btn-success btn-sm" type="button" onClick={finalizarEnvio} disabled={isSaving}>
            <i className="material-icons">send</i> FINALIZAR ENVIO
          </button>
        </div>
      </div>

      {showQr && (
        <div className="qr-modal">
          <div className="qr-modal-content">
            <div className="qr-modal-header">
              <h3>Leitor de QR Code</h3>
              <button type="button" className="qr-close" onClick={() => setShowQr(false)}>×</button>
            </div>
            <div className="qr-video-wrap">
              <video ref={videoRef} className="qr-video" muted playsInline />
            </div>
            {qrError && <div className="qr-error">{qrError}</div>}
            <div className="qr-help">Aponte a câmera para o QR. Se não funcionar, cole o JSON no campo.</div>
          </div>
        </div>
      )}

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

export default NovoOrcamento;
