import { useEffect, useMemo, useRef, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

type Item = {
  id: string;
  nf: string;
  data: string;
  codGemco: string;
  descricao: string;
  total: number;
};

const NovoOrcamento = () => {
  const [protocolo, setProtocolo] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [nfRemessa, setNfRemessa] = useState('');
  const [dataEntrada, setDataEntrada] = useState('');
  const [codGemco, setCodGemco] = useState('');
  const [descProd, setDescProd] = useState('');
  const [valPecas, setValPecas] = useState(0);
  const [valAcess, setValAcess] = useState(0);
  const [valMaoObra, setValMaoObra] = useState(0);
  const [valEmb, setValEmb] = useState(0);
  const [valHig, setValHig] = useState(0);
  const [itens, setItens] = useState<Item[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [qrError, setQrError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  useEffect(() => {
    const now = new Date();
    const prot = `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
    setProtocolo(prot);
    setDataEntrada(now.toISOString().slice(0, 10));

    const profileRaw = localStorage.getItem('gat_user_profile');
    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw) as {
          cnpj?: string;
          razao_social?: string;
          email?: string;
        };
        if (profile.cnpj) setCnpj(profile.cnpj);
        if (profile.razao_social) setRazaoSocial(profile.razao_social);
        if (profile.email) setEmail(profile.email);
      } catch {
        // ignore malformed profile
      }
    }

    const loadUserInfo = async () => {
      try {
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

        const fetchedCnpj = item.cnpj ?? item.CNPJ ?? '';
        const fetchedRazao = item.razao_social ?? item.RAZAO_SOCIAL ?? '';
        const fetchedEmail = item.email ?? item.EMAIL ?? '';

        if (fetchedCnpj) setCnpj(fetchedCnpj);
        if (fetchedRazao) setRazaoSocial(fetchedRazao);
        if (fetchedEmail) setEmail(fetchedEmail);
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

  const parseQrPayload = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const data = JSON.parse(trimmed);
      const legacyId = data?.legacyId ?? data?.LEGACYID ?? data?.legacy_id;
      const description = data?.description ?? data?.DESCRICAO ?? data?.descricao;
      const ean = data?.ean ?? data?.EAN ?? data?.codigo_barra;
      return {
        legacyId: legacyId ? String(legacyId) : '',
        description: description ? String(description) : '',
        ean: ean ? String(ean) : ''
      };
    } catch {
      return null;
    }
  };

  const handleQrInput = (raw: string) => {
    const parsed = parseQrPayload(raw);
    if (!parsed) return;
    if (parsed.legacyId) setCodGemco(parsed.legacyId);
    if (parsed.description) setDescProd(parsed.description);
  };

  const abrirLeitorQr = () => { setShowQr(true); };

  const buscarProdutoCadastro = async () => {
    try {
      if (!codGemco) return;
      const res = await oracleApi.get(ORACLE_ENDPOINTS.getProdutoCadastro, {
        params: {
          item: codGemco,
          codigo_barra: codGemco,
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

      const item = list[0] ?? data ?? {};
      const descricao = item.descricao ?? item.DESCRICAO ?? item.ds_produto ?? item.DS_PRODUTO ?? '';
      if (descricao) setDescProd(descricao);
    } catch {
      // silencioso
    }
  };

  const parseCurrency = (raw: string) => {
    const onlyDigits = raw.replace(/\D/g, '');
    const asNumber = Number(onlyDigits) / 100;
    return Number.isNaN(asNumber) ? 0 : asNumber;
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const total = useMemo(() => valPecas + valAcess + valMaoObra + valEmb + valHig, [valPecas, valAcess, valMaoObra, valEmb, valHig]);

  const criarId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID())
      || `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  const adicionarItem = () => {
    if (total <= 0) return;
    const item: Item = {
      id: criarId(),
      nf: nfRemessa || '-',
      data: dataEntrada || new Date().toISOString().slice(0, 10),
      codGemco: codGemco || '-',
      descricao: descProd || 'Sem descrição',
      total
    };
    setItens((prev) => [...prev, item]);
    setCodGemco('');
    setDescProd('');
  };

  const totalFormatado = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
      </div>

      <div className="card">
        <div className="section-title">Dados do Produto</div>
        <div className="grid-form">
          <div className="span-2"><label>NF Remessa</label><input type="text" value={nfRemessa} onChange={(e) => setNfRemessa(e.target.value)} /></div>
          <div className="span-2"><label>Data NF</label><input type="date" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} /></div>
          <div className="span-2">
            <label>Código (Item ou Barras)</label>
            <div className="qr-input-group">
              <input
                type="text"
                value={codGemco}
                onChange={(e) => setCodGemco(e.target.value)}
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
          <div className="span-6"><label>Descrição</label><input type="text" value={descProd} onChange={(e) => setDescProd(e.target.value)} /></div>
          <div className="span-12" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={buscarProdutoCadastro}>
              <i className="material-icons">search</i> BUSCAR PRODUTO
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Valores</div>
        <div className="grid-form">
          <div className="span-3"><label>Valor Peças</label><input type="text" inputMode="decimal" value={formatCurrency(valPecas)} onChange={(e) => setValPecas(parseCurrency(e.target.value))} /></div>
          <div className="span-3"><label>Valor Acessórios</label><input type="text" inputMode="decimal" value={formatCurrency(valAcess)} onChange={(e) => setValAcess(parseCurrency(e.target.value))} /></div>
          <div className="span-2"><label>Mão de Obra</label><input type="text" inputMode="decimal" value={formatCurrency(valMaoObra)} onChange={(e) => setValMaoObra(parseCurrency(e.target.value))} /></div>
          <div className="span-2"><label>Embalagem</label><input type="text" inputMode="decimal" value={formatCurrency(valEmb)} onChange={(e) => setValEmb(parseCurrency(e.target.value))} /></div>
          <div className="span-2"><label>Higienização</label><input type="text" inputMode="decimal" value={formatCurrency(valHig)} onChange={(e) => setValHig(parseCurrency(e.target.value))} /></div>
          <div className="span-6"><label>Total do Orçamento</label><input type="text" readOnly value={totalFormatado(total)} className="total-display" /></div>
        </div>
        <div className="action-bar">
          <button className="btn btn-secondary btn-sm" onClick={adicionarItem}>
            <i className="material-icons">save_as</i> ADICIONAR ITEM
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Itens neste Protocolo</div>
        <div className="table-scroll">
          <table className="tabela-horizontal">
            <thead>
              <tr>
                <th>NF Remessa</th>
                <th>Data NF</th>
                <th>Cód. GEMCO</th>
                <th>Descrição</th>
                <th>Total Orçamento</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#999' }}>Nenhum item adicionado.</td>
                </tr>
              )}
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>{item.nf}</td>
                  <td>{item.data}</td>
                  <td><strong>{item.codGemco}</strong></td>
                  <td>{item.descricao}</td>
                  <td style={{ fontWeight: 'bold', background: '#fff3cd' }}>{totalFormatado(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="action-bar" style={{ marginTop: 20 }}>
          <button className="btn btn-success btn-sm" type="button">
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
    </div>
  );
};

export default NovoOrcamento;
