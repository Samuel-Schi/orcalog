import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import {
  baixarModeloImportacao,
  COLUNAS_OBRIGATORIAS,
  chaveProduto,
  compactLookupValue,
  consultarProdutoPorCodigo,
  ErroImportacao,
  formatSerialValue,
  importarProdutos,
  lerPlanilhaExcel,
  normalizarCodigoProduto,
  validarArquivoExcel,
  validarItemManual,
  type ItemProduto as Item,
  type ResultadoLinha,
  type TipoCodigoProduto
} from '../lib/importacaoProdutos';

type ConsultaProduto = {
  status: 'idle' | 'carregando' | 'encontrado' | 'nao_encontrado' | 'erro';
  mensagem: string;
};

type ParsedQrPayload = {
  uuid: string;
  legacyId: string;
  ean: string;
  serial: string;
  raw: any;
};

const QR_FIELD_ALIASES: Record<string, string> = {
  UUID: 'UUID',
  DESCRIPTION: 'DESCRIPTION',
  LEGACYID: 'LEGACYID',
  LEGACYLD: 'LEGACYID',
  INVOICENUMBER: 'INVOICENUMBER',
  NVOICENUMBER: 'INVOICENUMBER',
  VOICENUMBER: 'INVOICENUMBER',
  EAN: 'EAN',
  AN: 'EAN',
  SERIAL: 'SERIAL',
  SERIALNUMBER: 'SERIAL',
  SN: 'SN',
  IMEI: 'IMEI',
  VOLUME: 'VOLUME',
  TOTAL: 'TOTAL'
};

const normalizeQrFieldKey = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .trim();

const canonicalizeQrFieldKey = (value: string) => {
  const normalized = normalizeQrFieldKey(value);
  return QR_FIELD_ALIASES[normalized] ?? normalized;
};

const sanitizeUuidValue = (value: unknown) =>
  String(value ?? '')
    .replace(/\D/g, '')
    .trim();

const sanitizeLegacyIdValue = (value: unknown) =>
  String(value ?? '')
    .replace(/[^0-9A-Za-z-]/g, '')
    .replace(/-/g, '')
    .trim();

const sanitizeEanValue = (value: unknown) =>
  String(value ?? '')
    .replace(/\D/g, '')
    .trim();

const hasLookupFields = (payload: Pick<ParsedQrPayload, 'uuid' | 'legacyId' | 'ean'> | null | undefined) =>
  Boolean(payload && (payload.legacyId || payload.ean || (payload.uuid && payload.uuid.length >= 8)));

const splitRawQrBlocks = (raw: string) =>
  String(raw || '')
    .replace(/\r/g, '\n')
    .split(/(?=[`{\s,;]*\^?\s*uuid\s*\^)/i)
    .map((part) => part.trim())
    .filter(Boolean);

const parseDelimitedQrFields = (raw: string) => {
  const source = String(raw || '')
    .replace(/\r/g, '\n')
    .replace(/[{}]+$/g, '')
    .trim();

  if (!source.includes('^')) return null;

  const fieldStartRegex =
    /(^|[,\s`{;])\^?\s*([a-z\u00C0-\u017F][a-z0-9_\u00C0-\u017F]*)\s*\^(?:[^a-z0-9\u00C0-\u017F]+?\^)?/gim;
  const starts = Array.from(source.matchAll(fieldStartRegex))
    .map((match) => {
      const prefixLength = (match[1] || '').length;
      const startIndex = (match.index ?? -1) + prefixLength;

      return {
        key: match[2] || '',
        index: startIndex,
        valueStart: (match.index ?? -1) + match[0].length
      };
    })
    .filter((entry) => entry.index >= 0 && entry.valueStart >= 0);

  if (starts.length === 0) return null;

  const fields: Record<string, string> = {};

  starts.forEach((entry, index) => {
    const end = starts[index + 1]?.index ?? source.length;
    const key = canonicalizeQrFieldKey(entry.key);

    if (!key) return;

    let value = source
      .slice(entry.valueStart, end)
      .replace(/^[,\s`{;]+/, '')
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .replace(/[\^,;`{}]+$/g, '')
      .trim();

    if (!value) return;

    if (key === 'EAN') {
      value = value.replace(/\D/g, '');
    }

    fields[key] = value;
  });

  return Object.keys(fields).length > 0 ? fields : null;
};

const parseMarkerBasedQrFields = (raw: string) => {
  const compact = String(raw || '')
    .replace(/[\u0000-\u001F\u007F]+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();

  const markers = Array.from(new Set(Object.keys(QR_FIELD_ALIASES)))
    .sort((a, b) => b.length - a.length);

  const positions = markers
    .map((marker) => ({ marker, index: compact.indexOf(marker) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (positions.length === 0) return null;

  const fields: Record<string, string> = {};
  positions.forEach((entry, index) => {
    const start = entry.index + entry.marker.length;
    const end = positions[index + 1]?.index ?? compact.length;
    const value = compact.slice(start, end).trim();
    if (!value) return;

    const markerKey = canonicalizeQrFieldKey(entry.marker);
    if (!fields[markerKey]) {
      fields[markerKey] = markerKey === 'EAN' ? value.replace(/\D/g, '') : value;
    }
  });

  return fields.UUID || fields.LEGACYID || fields.EAN ? fields : null;
};

const draftKey = (paUsuario: string) => `orcamento_rascunho:${paUsuario}`;

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
  const [manualMode, setManualMode] = useState(false);
  const [abaProduto, setAbaProduto] = useState<'bipagem' | 'importacao'>('bipagem');
  const [consultaProduto, setConsultaProduto] = useState<ConsultaProduto>({ status: 'idle', mensagem: '' });
  const [importando, setImportando] = useState(false);
  const [progressoImportacao, setProgressoImportacao] = useState({ processadas: 0, total: 0 });
  const [resultadosImportacao, setResultadosImportacao] = useState<ResultadoLinha[]>([]);
  const [erroImportacao, setErroImportacao] = useState('');
  const [arquivoImportacao, setArquivoImportacao] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestSeqRef = useRef(0);
  const pendingScanRef = useRef<ParsedQrPayload | null>(null);
  const serialInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const uuidInputRef = useRef<HTMLInputElement | null>(null);
  // Digitacao manual: cada incremento pede para adicionar o item assim que estiver completo.
  const [pedidoAutoAdicionar, setPedidoAutoAdicionar] = useState(0);
  const draftHydratedRef = useRef(false);
  const serialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupInFlightRef = useRef('');
  // Codigos ja consultados ('gemco:X' / 'ean:Y'): evita repetir a consulta no Enter + blur do leitor.
  const codigosConsultadosRef = useRef(new Set<string>());
  const consultaSeqRef = useRef(0);
  const preenchidoPelaApiRef = useRef(false);
  const arquivoInputRef = useRef<HTMLInputElement | null>(null);

  const gerarProtocolo = () => {
    const now = new Date();
    return `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  const focusCodeInput = () => {
    requestAnimationFrame(() => {
      codeInputRef.current?.focus();
      codeInputRef.current?.select();
    });
  };

  const finalizeSerialInput = (raw: string) => {
    if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
    const formatted = formatSerialValue(raw);
    setSerial(formatted);
    if (formatted) {
      focusCodeInput();
    }
  };

  useEffect(() => {
    let cancelled = false;

    // Rascunho fica so no navegador: nao gera requisicao (nem log) no Supabase.
    const loadDraftLocal = async () => {
      const paUsuario = (localStorage.getItem('gat_user') || '').trim();
      if (!paUsuario) {
        setProtocolo(gerarProtocolo());
        return;
      }

      try {
        const salvo = JSON.parse(localStorage.getItem(draftKey(paUsuario)) || 'null');
        const draft = salvo && typeof salvo === 'object'
          ? salvo as Partial<{
            protocolo: string;
            cnpj: string;
            razaoSocial: string;
            email: string;
            unidade: string;
            uuid: string;
            ean: string;
            codGemco: string;
            descProd: string;
            fornecedor: string;
            linha: string;
            serial: string;
            itens: Item[];
          }>
          : null;

        if (cancelled) return;

        if (draft) {
          if (draft.protocolo) setProtocolo(String(draft.protocolo));
          if (draft.cnpj) setCnpj(String(draft.cnpj));
          if (draft.razaoSocial) setRazaoSocial(String(draft.razaoSocial));
          if (draft.email) setEmail(String(draft.email));
          if (draft.unidade) setUnidade(String(draft.unidade));
          if (draft.uuid) setUuid(String(draft.uuid));
          if (draft.ean) setEan(String(draft.ean));
          if (draft.codGemco) setCodGemco(String(draft.codGemco));
          if (draft.descProd) setDescProd(String(draft.descProd));
          if (draft.fornecedor) setFornecedor(String(draft.fornecedor));
          if (draft.linha) setLinha(String(draft.linha));
          if (draft.serial) setSerial(String(draft.serial));
          if (Array.isArray(draft.itens)) setItens(draft.itens);
        } else {
          setProtocolo(gerarProtocolo());
        }
      } catch {
        if (!cancelled) {
          setProtocolo(gerarProtocolo());
        }
      }
    };

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

        if (cancelled) return;

        const item = list[0] ?? data ?? {};

        const getField = (source: any, keys: string[]) => {
          if (!source || typeof source !== 'object') return '';
          const lowerMap = new Map<string, string>();
          Object.keys(source).forEach((k) => lowerMap.set(k.toLowerCase(), k));
          for (const key of keys) {
            const realKey = lowerMap.get(key.toLowerCase());
            if (realKey && source[realKey] !== null && source[realKey] !== undefined && source[realKey] !== '') {
              const value = String(source[realKey]).trim();
            if (value) return value;
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

    void (async () => {
      await loadDraftLocal();
      await loadUserInfo();
      if (!cancelled) {
        draftHydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const paUsuario = (localStorage.getItem('gat_user') || '').trim();
    if (!paUsuario) return;
    const hasDraftContent = Boolean(
      cnpj
      || razaoSocial
      || email
      || unidade
      || uuid
      || ean
      || codGemco
      || descProd
      || fornecedor
      || linha
      || serial
      || itens.length > 0
    );
    if (!hasDraftContent) return;

    const handle = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(paUsuario), JSON.stringify({
          protocolo,
          cnpj,
          razaoSocial,
          email,
          unidade,
          uuid,
          ean,
          codGemco,
          descProd,
          fornecedor,
          linha,
          serial,
          itens
        }));
      } catch {
        // silencioso: mantem a tela responsiva se o rascunho falhar
      }
    }, 800);

    return () => window.clearTimeout(handle);
  }, [protocolo, cnpj, razaoSocial, email, unidade, uuid, ean, codGemco, descProd, fornecedor, linha, serial, itens]);

  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    let frameId = 0;
    let stream: MediaStream | null = null;
    let fallbackControls: IScannerControls | null = null;

    const start = async () => {
      try {
        setQrError('');
        if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
          setQrError('Este navegador não permite o acesso à câmera.');
          return;
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          const reader = new BrowserQRCodeReader();
          fallbackControls = await reader.decodeFromConstraints(
            {
              video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
              },
              audio: false
            },
            videoRef.current,
            (result, _error, controls) => {
              const value = result?.getText().trim();
              if (value && !cancelled) {
                cancelled = true;
                controls.stop();
                handleQrInput(value);
                setShowQr(false);
              }
            }
          );
          if (cancelled) fallbackControls.stop();
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
        let lastAttempt = 0;
        const scan = async (now: number) => {
          if (cancelled || !videoRef.current) return;
          if (now - lastAttempt >= 120 && videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            lastAttempt = now;
            try {
              const barcodes = await detector.detect(videoRef.current);
              const value = barcodes?.[0]?.rawValue?.trim();
              if (value && !cancelled) {
                handleQrInput(value);
                setShowQr(false);
                return;
              }
            } catch {
              // A câmera pode ainda estar ajustando foco/exposição; tenta novamente.
            }
          }
          if (!cancelled) frameId = requestAnimationFrame(scan);
        };
        frameId = requestAnimationFrame(scan);
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;
        const name = error instanceof DOMException ? error.name : '';
        setQrError(
          name === 'NotAllowedError'
            ? 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador.'
            : 'Não foi possível iniciar a câmera. Verifique se ela está em uso por outro aplicativo.'
        );
      }
    };

    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      fallbackControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [showQr]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    if (manualMode || !codGemco.trim()) return;
    const handle = setTimeout(() => {
      const parsed = parseQrPayload(codGemco);
      if (parsed && hasLookupFields(parsed)) {
        pendingScanRef.current = parsed;
        if (parsed.uuid) setUuid(parsed.uuid);
        if (parsed.ean) setEan(parsed.ean);
        if (parsed.serial) setSerial(parsed.serial);
        void buscarProdutoCadastro(parsed);
      } else if (!/[{^]/.test(codGemco) && !/^UUID/i.test(codGemco)) {
        void buscarProdutoCadastro();
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [codGemco, manualMode]);

  useEffect(() => () => {
    if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
    requestSeqRef.current += 1;
    consultaSeqRef.current += 1;
  }, []);

  const parseQrPayload = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const buildParsedPayload = (data: Record<string, unknown>) => {
      const uuid = sanitizeUuidValue(data?.uuid ?? data?.UUID ?? data?.Uuid);
      const legacyId = sanitizeLegacyIdValue(data?.legacyId ?? data?.LEGACYID ?? data?.legacy_id ?? data?.LEGACYID);
      const eanValue = sanitizeEanValue(data?.ean ?? data?.EAN ?? data?.codigo_barra ?? data?.cod_barra ?? data?.codBarra);
      const serialValue =
        data?.serial
        ?? data?.SERIAL
        ?? data?.sn
        ?? data?.SN
        ?? data?.serialNumber
        ?? data?.serial_number
        ?? data?.imei
        ?? data?.IMEI;

      return {
        uuid,
        legacyId,
        ean: eanValue,
        serial: serialValue ? formatSerialValue(String(serialValue)) : '',
        raw: data
      };
    };

    try {
      return buildParsedPayload(JSON.parse(trimmed));
    } catch {
      const delimitedFields = parseDelimitedQrFields(trimmed);
      if (delimitedFields) {
        const delimitedPayload = buildParsedPayload({
          uuid: delimitedFields.UUID,
          legacyId: delimitedFields.LEGACYID,
          ean: delimitedFields.EAN,
          serial: delimitedFields.SERIAL ?? delimitedFields.SN ?? delimitedFields.IMEI,
          description: delimitedFields.DESCRIPTION,
          invoiceNumber: delimitedFields.INVOICENUMBER,
          volume: delimitedFields.VOLUME,
          total: delimitedFields.TOTAL,
          ...delimitedFields
        });

        if (hasLookupFields(delimitedPayload)) {
          return delimitedPayload;
        }
      }

      const markerFields = parseMarkerBasedQrFields(trimmed);
      if (markerFields) {
        const markerPayload = buildParsedPayload({
          uuid: markerFields.UUID,
          legacyId: markerFields.LEGACYID,
          ean: markerFields.EAN,
          serial: markerFields.SERIAL ?? markerFields.SN ?? markerFields.IMEI,
          description: markerFields.DESCRIPTION,
          invoiceNumber: markerFields.INVOICENUMBER,
          volume: markerFields.VOLUME,
          total: markerFields.TOTAL,
          ...markerFields
        });

        if (hasLookupFields(markerPayload)) {
          return markerPayload;
        }
      }

      const blocks = splitRawQrBlocks(trimmed);

      for (const block of blocks) {
        const normalizedBlock = block
          .replace(/[\u0000-\u001F\u007F]+/g, ' ')
          .replace(/[;,]?\s*\{$/, '')
          .trim();

        if (!normalizedBlock) continue;

        const parsedFields = parseDelimitedQrFields(normalizedBlock);
        if (!parsedFields || Object.keys(parsedFields).length === 0) continue;

        const payload = buildParsedPayload({
          uuid: parsedFields.UUID,
          legacyId: parsedFields.LEGACYID,
          ean: parsedFields.EAN,
          serial: parsedFields.SERIAL ?? parsedFields.SN ?? parsedFields.IMEI,
          description: parsedFields.DESCRIPTION,
          invoiceNumber: parsedFields.INVOICENUMBER,
          volume: parsedFields.VOLUME,
          total: parsedFields.TOTAL,
          ...parsedFields
        });

        if (hasLookupFields(payload)) {
          return payload;
        }
      }

      return null;
    }
  };

  const normalizeCode = (value: string) => compactLookupValue(value);

  const applyParsedScan = (parsed: ParsedQrPayload) => {
    requestSeqRef.current += 1;
    pendingScanRef.current = parsed;

    const normalizedLegacyId = parsed.legacyId ? normalizeCode(parsed.legacyId) : '';
    const normalizedEan = parsed.ean ? normalizeCode(parsed.ean) : '';

    if (parsed.uuid) setUuid(parsed.uuid);
    if (normalizedEan) setEan(normalizedEan);
    if (parsed.serial) setSerial(parsed.serial);
    if (normalizedLegacyId) {
      setCodGemco(normalizedLegacyId);
    } else if (normalizedEan || parsed.uuid) {
      setCodGemco(normalizedEan || parsed.uuid);
    }


  };

  const handleQrInput = (raw: string) => {
    const parsed = parseQrPayload(raw);
    if (!parsed) {
      pendingScanRef.current = null;
      return;
    }
    applyParsedScan(parsed);
  };

  const abrirLeitorQr = () => { setShowQr(true); };

  const selecionarModo = (modo: 'bipagem' | 'manual' | 'importacao') => {
    if (importando) return;
    const manual = modo === 'manual';
    setAbaProduto(modo === 'importacao' ? 'importacao' : 'bipagem');
    setManualMode(manual);
    setConsultaProduto({ status: 'idle', mensagem: '' });
    consultaSeqRef.current += 1;
    codigosConsultadosRef.current.clear();
    pendingScanRef.current = null;
    if (manual) {
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } else if (modo === 'bipagem') {
      requestAnimationFrame(() => serialInputRef.current?.focus());
    }
  };

  const validarDadosCabecalho = () => {
    if (!email.trim()) {
      setToast({ type: 'error', message: 'Obrigatorio preencher o e-mail de retorno.' });
      return false;
    }

    if (!unidade.trim()) {
      setToast({ type: 'error', message: 'Obrigatorio preencher a unidade.' });
      return false;
    }

    return true;
  };

  const validarDadosItem = (values: {
    serial: string;
    codGemco: string;
    descricao: string;
  }) => {
    if (!values.serial.trim() || values.serial.trim() === '-') {
      setToast({ type: 'error', message: 'Obrigatorio preencher o serial.' });
      return false;
    }

    if (!values.codGemco.trim()) {
      setToast({ type: 'error', message: 'Obrigatorio preencher o codigo do produto.' });
      return false;
    }

    if (!values.descricao.trim()) {
      setToast({ type: 'error', message: 'Obrigatorio preencher a descricao do produto.' });
      return false;
    }

    return true;
  };

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

    if (!override && manualMode) {
      const erroManual = validarItemManual({
        serial: finalSerial,
        uuid: finalUuid,
        codGemco: finalCodGemco,
        ean: finalEan,
        descricao: finalDesc
      });
      if (erroManual) {
        setToast({ type: 'error', message: erroManual });
        return false;
      }
      const chave = chaveProduto({ serial: finalSerial, codGemco: finalCodGemco });
      if (finalCodGemco.trim() && itens.some((item) => chaveProduto(item) === chave)) {
        setToast({ type: 'error', message: 'Este serial com este Gemco já está no protocolo.' });
        return false;
      }
    } else if (!validarDadosItem({
      serial: finalSerial,
      codGemco: finalCodGemco,
      descricao: finalDesc
    })) {
      return false;
    }
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
      status: 0
    };
    setItens((prev) => [...prev, item]);
    setCodGemco('');
    setUuid('');
    setEan('');
    setDescProd('');
    setFornecedor('');
    setLinha('');
    setSerial('');
    consultaSeqRef.current += 1;
    codigosConsultadosRef.current.clear();
    preenchidoPelaApiRef.current = false;
    setConsultaProduto({ status: 'idle', mensagem: '' });
    serialInputRef.current?.focus();
    return true;
  };

  const pendenciaManual = manualMode
    ? validarItemManual({ serial, uuid, codGemco, ean, descricao: descProd })
    : '';

  const pedirAutoAdicionar = () => {
    if (manualMode) setPedidoAutoAdicionar((n) => n + 1);
  };

  const adicionarComEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!manualMode || e.key !== 'Enter') return;
    e.preventDefault();
    pedirAutoAdicionar();
  };

  // Roda depois do render, com os valores ja atualizados (consulta da API, Enter nos campos).
  useEffect(() => {
    if (!pedidoAutoAdicionar || !manualMode || abaProduto !== 'bipagem' || consultaProduto.status === 'carregando') return;
    if (pendenciaManual) {
      if (!serial.trim()) serialInputRef.current?.focus();
      else if (!uuid.trim()) uuidInputRef.current?.focus();
      return;
    }
    if (adicionarItem()) setToast({ type: 'success', message: 'Item adicionado automaticamente ao protocolo.' });
  }, [pedidoAutoAdicionar]);

  const buscarProdutoCadastro = async (parsedScan?: ParsedQrPayload) => {
    const pendingScan = parsedScan || pendingScanRef.current;
    const lookupItem = normalizeCode(pendingScan?.legacyId || pendingScan?.ean || pendingScan?.uuid || codGemco);
    const lookupEan = normalizeCode(pendingScan?.ean || (codGemco.length >= 8 ? codGemco : ''));
    const serialAtual = pendingScan?.serial || serial;
    if (!lookupItem || !serialAtual) return;
    const lookupKey = `${serialAtual}|${lookupItem}|${lookupEan}`;
    if (lookupInFlightRef.current === lookupKey) return;
    lookupInFlightRef.current = lookupKey;
    const requestId = ++requestSeqRef.current;
    try {
      setDescProd('');
      setFornecedor('');
      setLinha('');
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
            const value = String(source[realKey]).trim();
            if (value) return value;
          }
        }
        return '';
      };

      const fetchedItem = getField(item, ['item', 'cod_gemco', 'codigo', 'cod_item', 'item_codigo']);
      const descricao = getField(item, ['descricao', 'ds_produto', 'descricao_produto', 'desc_produto', 'description', 'produto'])
        || getField(pendingScan?.raw, ['description', 'descricao', 'descricao_produto', 'ds_produto']);
      const eanApi = getField(item, ['cod_barra', 'codigo_barra', 'codigo_barras', 'ean']);
      const uuidApi = getField(item, ['uuid', 'id_unico']);
      const fornecedorApi = getField(item, ['fornecedor', 'ds_fornecedor', 'desc_fornecedor', 'fornecedor_desc', 'nome_fornecedor']);
      const linhaApi = getField(item, ['linha', 'ds_linha', 'desc_linha', 'linha_desc', 'nome_linha']);
      if (descricao) setDescProd(descricao);
      if (eanApi) setEan(eanApi);
      if (uuidApi) setUuid(uuidApi);
      if (fornecedorApi) setFornecedor(String(fornecedorApi));
      if (linhaApi) setLinha(String(linhaApi));

      if (descricao) {
        adicionarItem({
          uuid: pendingScan?.uuid || uuidApi || uuid,
          ean: eanApi || pendingScan?.ean || lookupEan,
          codGemco: fetchedItem || lookupItem,
          descricao,
          fornecedor: fornecedorApi || '',
          linha: linhaApi || '',
          serial: serialAtual
        });
        pendingScanRef.current = null;
        setToast({ type: 'success', message: 'Item adicionado automaticamente ao protocolo.' });
      } else {
        setToast({ type: 'error', message: 'O cadastro do Oracle e a etiqueta vieram sem descricao. Use Digitar manual para preencher a descricao e adicionar o item.' });
      }
    } catch {
      if (requestId === requestSeqRef.current) setToast({ type: 'error', message: 'Nao foi possivel consultar o produto. Tente bipar novamente.' });
    } finally {
      if (lookupInFlightRef.current === lookupKey) lookupInFlightRef.current = '';
    }
  };

  // Digitacao manual: Gemco ou codigo de barras (qualquer um) busca descricao, fornecedor e linha.
  const buscarProdutoManual = async (tipo: TipoCodigoProduto, value: string, viaEnter = false) => {
    const codigoInformado = normalizarCodigoProduto(tipo, value);
    if (!manualMode || !codigoInformado) return;
    const chave = `${tipo}:${codigoInformado}`;
    if (codigosConsultadosRef.current.has(chave)) {
      // Codigo ja consultado: Enter de novo so tenta adicionar.
      if (viaEnter) pedirAutoAdicionar();
      return;
    }

    codigosConsultadosRef.current.add(chave);
    const requestId = ++consultaSeqRef.current;
    setConsultaProduto({ status: 'carregando', mensagem: 'Consultando produto...' });
    const resultado = await consultarProdutoPorCodigo(tipo, codigoInformado, (codigo) => consultarCadastroProduto({ item: codigo }));
    if (requestId !== consultaSeqRef.current) return;

    if (resultado.status === 'encontrado') {
      const { produto } = resultado;
      if (produto.ean) {
        setEan(produto.ean);
        codigosConsultadosRef.current.add(`ean:${produto.ean}`);
      }
      if (produto.codGemco) {
        setCodGemco(produto.codGemco);
        codigosConsultadosRef.current.add(`gemco:${normalizarCodigoProduto('gemco', produto.codGemco)}`);
      }
      setDescProd(produto.descricao);
      setFornecedor(produto.fornecedor);
      setLinha(produto.linha);
      preenchidoPelaApiRef.current = true;
      setPedidoAutoAdicionar((n) => n + 1);
    } else {
      // Falha temporaria pode ser repetida com o mesmo codigo.
      if (resultado.status === 'erro') codigosConsultadosRef.current.delete(chave);
      // So limpa o que veio de uma consulta anterior; texto digitado pelo usuario e mantido.
      if (preenchidoPelaApiRef.current) {
        preenchidoPelaApiRef.current = false;
        setDescProd('');
        setFornecedor('');
        setLinha('');
      }
    }
    setConsultaProduto({ status: resultado.status, mensagem: resultado.mensagem });
  };

  // get_produto_cadastro casa o valor com o Gemco (item) OU com o EAN (codigo_barra);
  // enviar o mesmo codigo nos dois aceita qualquer um, digitado em qualquer campo.
  const consultarCadastroProduto = async ({ item }: { item: string }) => {
    const res = await oracleApi.get(ORACLE_ENDPOINTS.getProdutoCadastro, {
      params: { item, codigo_barra: item, _ts: Date.now() },
      responseType: 'arraybuffer',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      validateStatus: (status) => status >= 200 && status < 400
    });
    return parseMaybeJson(res.data);
  };

  const importarArquivo = async (arquivo: File) => {
    if (importando) return;
    setErroImportacao('');
    setResultadosImportacao([]);
    setArquivoImportacao(arquivo.name);
    setProgressoImportacao({ processadas: 0, total: 0 });
    setImportando(true);
    try {
      validarArquivoExcel(arquivo);
      const { linhas, erros } = await lerPlanilhaExcel(await arquivo.arrayBuffer());
      const { itens: itensAtualizados, resultados } = await importarProdutos({
        linhas,
        itensAtuais: itens,
        protocolo,
        consultar: consultarCadastroProduto,
        criarId,
        onProgresso: (processadas, total) => setProgressoImportacao({ processadas, total })
      });
      const todos = [...erros, ...resultados].sort((a, b) => a.linha - b.linha);
      setItens(itensAtualizados);
      setResultadosImportacao(todos);
      const comErro = todos.filter((resultado) => resultado.status === 'erro').length;
      setToast(comErro
        ? { type: 'error', message: `Importação concluída com ${comErro} linha(s) com erro. Confira o resultado abaixo.` }
        : { type: 'success', message: `${todos.length} linha(s) importada(s) com sucesso.` });
    } catch (error) {
      setErroImportacao(error instanceof ErroImportacao ? error.message : 'Não foi possível processar o arquivo. Tente novamente.');
    } finally {
      setImportando(false);
      if (arquivoInputRef.current) arquivoInputRef.current.value = '';
    }
  };

  const criarId = () =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto && crypto.randomUUID())
      || `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  const removerItem = (id: string) => setItens((prev) => prev.filter((item) => item.id !== id));

  const serialPronto = Boolean(serial.trim());

  const finalizarEnvio = async () => {
    if (itens.length === 0 || isSaving) return;
    if (!validarDadosCabecalho()) {
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
        localStorage.removeItem(draftKey((localStorage.getItem('gat_user') || '').trim()));
      } catch {
        // ignore local draft cleanup errors
      }
    } catch {
      setToast({ type: 'error', message: 'Não foi possível enviar. Tente novamente.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id="viewNovoOrcamento" className="view-section novo-orcamento-page">
      <h2 className="page-title">Novo Orçamento</h2>

      <div className="card">
        <div className="grid-form novo-orcamento-grid">
          <div className="span-2"><label>Protocolo</label><input type="text" value={protocolo} readOnly /></div>
          <div className="span-2"><label>Usuário</label><input type="text" value={localStorage.getItem('gat_user') || ''} readOnly /></div>
          <div className="span-2"><label>CNPJ</label><input type="text" value={formatCnpj(cnpj)} readOnly /></div>
          <div className="span-2"><label>Razão Social</label><input type="text" value={razaoSocial} readOnly /></div>
          <div className="span-4">
            <label>Email Retorno *</label>
            <input
              type="email"
              value={email}
              required
              placeholder="Obrigatorio preencher"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="grid-form novo-orcamento-grid" style={{ marginTop: 10 }}>
          <div className="span-4">
            <label>Unidade *</label>
            <select
              value={unidade}
              required
              onChange={(e) => setUnidade(e.target.value)}
            >
              <option value="">Selecione a unidade</option>
              {[49, 93, 299, 389, 549, 893, 985, 1116, 2099, 2599, 2999, 5299, 5599].map((codigo) => (
                <option key={codigo} value={String(codigo)}>DQS - {codigo}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Dados do Produto</div>
        <div className="novo-orcamento-modos" role="tablist" aria-label="Forma de entrada dos produtos">
          {([
            ['bipagem', 'qr_code_scanner', 'Bipar etiqueta', 'Leitor ou câmera (QR)'],
            ['manual', 'keyboard', 'Digitar manual', 'Etiqueta ilegível ou sem QR'],
            ['importacao', 'upload_file', 'Importar Excel', 'Vários produtos de uma vez']
          ] as const).map(([modo, icone, titulo, detalhe]) => {
            const ativo = modo === 'importacao' ? abaProduto === 'importacao' : abaProduto === 'bipagem' && manualMode === (modo === 'manual');
            return (
              <button
                key={modo}
                type="button"
                role="tab"
                aria-selected={ativo}
                className={`novo-orcamento-modo${ativo ? ' ativo' : ''}`}
                onClick={() => selecionarModo(modo)}
                disabled={importando && !ativo}
              >
                <i className="material-icons" aria-hidden="true">{icone}</i>
                <span><strong>{titulo}</strong><small>{detalhe}</small></span>
              </button>
            );
          })}
        </div>

        {abaProduto === 'importacao' ? (
          <div className="novo-orcamento-importacao">
            <div className="novo-orcamento-help">
              Envie uma planilha .xlsx ou .xls com as colunas <strong>{COLUNAS_OBRIGATORIAS.join(', ')}</strong> na primeira linha.
              Cada linha é consultada no cadastro de produtos para completar descrição, código de barras, fornecedor e linha.
              Produtos com o mesmo serial e Gemco já presentes no protocolo são atualizados, não duplicados.
            </div>
            <div className="novo-orcamento-importacao-acoes">
              <input
                ref={arquivoInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                hidden
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  if (arquivo) void importarArquivo(arquivo);
                }}
              />
              <button className="btn btn-primary btn-sm" type="button" disabled={importando} onClick={() => arquivoInputRef.current?.click()}>
                <i className="material-icons">upload_file</i> {importando ? 'Importando...' : 'Selecionar planilha'}
              </button>
              <button className="btn btn-secondary btn-sm" type="button" disabled={importando} onClick={() => {
                baixarModeloImportacao().catch(() => setToast({ type: 'error', message: 'Não foi possível gerar o modelo. Tente novamente.' }));
              }}>
                <i className="material-icons">download</i> Baixar modelo
              </button>
              {arquivoImportacao && <span className="novo-orcamento-arquivo">{arquivoImportacao}</span>}
            </div>

            {importando && (
              <div className="novo-orcamento-progresso" role="status" aria-live="polite">
                <progress value={progressoImportacao.processadas} max={Math.max(progressoImportacao.total, 1)} />
                <span>
                  {progressoImportacao.total
                    ? `Consultando produtos: ${progressoImportacao.processadas} de ${progressoImportacao.total}`
                    : 'Lendo planilha...'}
                </span>
              </div>
            )}

            {erroImportacao && <div className="novo-orcamento-alerta erro" role="alert">{erroImportacao}</div>}

            {resultadosImportacao.length > 0 && (
              <div className="novo-orcamento-resultado">
                <div className="novo-orcamento-resultado-resumo">
                  <span className="item-count-badge importado">{resultadosImportacao.filter((r) => r.status === 'importado').length} importada(s)</span>
                  <span className="item-count-badge atualizado">{resultadosImportacao.filter((r) => r.status === 'atualizado').length} atualizada(s)</span>
                  <span className="item-count-badge erro">{resultadosImportacao.filter((r) => r.status === 'erro').length} com erro</span>
                </div>
                <div className="table-scroll novo-orcamento-resultado-tabela">
                  <table className="tabela-horizontal">
                    <thead>
                      <tr>
                        <th>Linha</th>
                        <th>Serial</th>
                        <th>Gemco</th>
                        <th>Situação</th>
                        <th>Detalhe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultadosImportacao.map((resultado) => (
                        <tr key={`${resultado.linha}-${resultado.status}`} className={`resultado-${resultado.status}`}>
                          <td>{resultado.linha}</td>
                          <td>{resultado.serial || '-'}</td>
                          <td>{resultado.codGemco || '-'}</td>
                          <td><strong>{resultado.status === 'erro' ? 'Erro' : resultado.status === 'atualizado' ? 'Atualizado' : 'Importado'}</strong></td>
                          <td>{resultado.mensagem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
        <>
        <div className="novo-orcamento-help">
          {manualMode
            ? 'Serial e ID único são obrigatórios. Informe o Gemco ou o código de barras (basta um) e tecle Enter: descrição, fornecedor e linha são preenchidos automaticamente.'
            : 'Campos com * sao obrigatorios. Bipe o serial e depois o código/QR da etiqueta. Se a etiqueta estiver rasurada, rasgada, suja ou ilegivel, use "Digitar manual".'}
        </div>
        <div className="grid-form novo-orcamento-grid novo-orcamento-grid-produto">
          <div className="span-3">
            <label>Serial *</label>
            <input
              ref={serialInputRef}
              type="text"
              value={serial}
              required
              placeholder="Obrigatorio preencher"
              onChange={(e) => {
                const value = e.target.value;
                setSerial(formatSerialValue(value));
                if (serialTimerRef.current) clearTimeout(serialTimerRef.current);
                if (!manualMode && value.trim()) serialTimerRef.current = setTimeout(() => finalizeSerialInput(value), 450);
              }}
              onKeyDown={(e) => {
                const value = (e.currentTarget as HTMLInputElement).value;
                if (manualMode && e.key === 'Enter' && (codGemco.trim() || ean.trim())) {
                  // Produto ja informado: Enter no serial adiciona direto se estiver tudo completo.
                  e.preventDefault();
                  setSerial(formatSerialValue(value));
                  pedirAutoAdicionar();
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  finalizeSerialInput(value);
                }
              }}
              onBlur={(e) => {
                if (manualMode) setSerial(formatSerialValue(e.target.value));
                else finalizeSerialInput(e.target.value);
              }}
            />
          </div>
          <div className="span-5 novo-orcamento-gemco-field">
            <label>{manualMode ? 'Código GEMCO (ou código de barras)' : 'Código GEMCO *'}</label>
            <div className="qr-input-group novo-orcamento-qr-group">
              <input
                ref={codeInputRef}
                type="text"
                value={codGemco}
                disabled={!serialPronto && !manualMode}
                required={!manualMode}
                placeholder={manualMode ? 'Digite o Gemco e tecle Enter' : (serialPronto ? 'Bipe o código/QR' : 'Preencha o serial antes')}
                aria-busy={manualMode && consultaProduto.status === 'carregando'}
                onBlur={(e) => { if (manualMode) void buscarProdutoManual('gemco', e.target.value); }}
                onChange={(e) => {
                  const value = e.target.value;
                  requestSeqRef.current += 1;
                  setCodGemco(value);
                  if (manualMode) {
                    consultaSeqRef.current += 1;
                    codigosConsultadosRef.current.clear();
                    setConsultaProduto({ status: 'idle', mensagem: '' });
                    return;
                  }
                  const trimmed = value.trim();
                  if (
                    trimmed.startsWith('{')
                    || trimmed.includes('"legacyId"')
                    || trimmed.includes('"uuid"')
                    || trimmed.includes('"ean"')
                    || /\^UUID\^/i.test(trimmed)
                    || /^UUID\d+/i.test(trimmed)
                  ) {
                    pendingScanRef.current = null;
                  } else {
                    pendingScanRef.current = null;
                    const normalized = normalizeCode(value);
                    if (normalized.length >= 8) {
                      setEan(normalized);
                    } else {
                      setEan('');
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (!manualMode && (e.key === 'Enter' || e.key === 'Tab')) e.preventDefault();
                  if (manualMode && e.key === 'Enter') {
                    e.preventDefault();
                    void buscarProdutoManual('gemco', e.currentTarget.value, true);
                  }
                }}
              />
              <button
                className="btn btn-secondary btn-sm novo-orcamento-qr-button novo-orcamento-qr-scan-button"
                type="button"
                onClick={abrirLeitorQr}
                disabled={!serialPronto}
                title="Ler QR Code"
              >
                QR
              </button>
            </div>
          </div>
          <div className="span-2">
            <label>{manualMode ? 'ID Unico *' : 'ID Unico'}</label>
            <input
              ref={uuidInputRef}
              type="text"
              value={uuid}
              readOnly={!manualMode}
              required={manualMode}
              placeholder={manualMode ? 'Obrigatorio preencher' : ''}
              onChange={(e) => setUuid(sanitizeUuidValue(e.target.value))}
              onKeyDown={(e) => {
                if (manualMode && e.key === 'Enter') {
                  e.preventDefault();
                  pedirAutoAdicionar();
                }
              }}
            />
          </div>
          <div className="span-2">
            <label>{manualMode ? 'Código de Barras (ou Gemco)' : 'Código de Barras'}</label>
            <input
              type="text"
              value={ean}
              readOnly={!manualMode}
              placeholder={manualMode ? 'Digite ou bipe o código' : ''}
              aria-busy={consultaProduto.status === 'carregando'}
              aria-describedby="novo-orcamento-consulta-status"
              onChange={(e) => {
                setEan(sanitizeEanValue(e.target.value));
                consultaSeqRef.current += 1;
                codigosConsultadosRef.current.clear();
                setConsultaProduto({ status: 'idle', mensagem: '' });
              }}
              onBlur={(e) => void buscarProdutoManual('ean', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void buscarProdutoManual('ean', e.currentTarget.value, true);
                }
              }}
            />
          </div>
          {manualMode && consultaProduto.status !== 'idle' && (
            <div
              id="novo-orcamento-consulta-status"
              className={`span-12 novo-orcamento-alerta ${consultaProduto.status === 'encontrado' ? 'sucesso' : consultaProduto.status === 'carregando' ? 'carregando' : 'erro'}`}
              role={consultaProduto.status === 'carregando' || consultaProduto.status === 'encontrado' ? 'status' : 'alert'}
            >
              {consultaProduto.status === 'carregando' && <span className="novo-orcamento-spinner" aria-hidden="true" />}
              {consultaProduto.mensagem}
            </div>
          )}
          <div className="span-6">
            <label>Descrição *</label>
            <input
              type="text"
              value={descProd}
              readOnly={!manualMode || consultaProduto.status === 'carregando'}
              required
              placeholder={consultaProduto.status === 'carregando' ? 'Consultando...' : (manualMode ? 'Obrigatorio preencher' : '')}
              onChange={(e) => {
                preenchidoPelaApiRef.current = false;
                setDescProd(e.target.value);
              }}
              onKeyDown={adicionarComEnter}
            />
          </div>
          <div className="span-3">
            <label>Fornecedor</label>
            <input
              type="text"
              value={fornecedor}
              readOnly={!manualMode || consultaProduto.status === 'carregando'}
              placeholder={consultaProduto.status === 'carregando' ? 'Consultando...' : (manualMode ? 'Digite manualmente se necessario' : '')}
              onChange={(e) => {
                preenchidoPelaApiRef.current = false;
                setFornecedor(e.target.value);
              }}
              onKeyDown={adicionarComEnter}
            />
          </div>
          <div className="span-3">
            <label>Linha</label>
            <input
              type="text"
              value={linha}
              readOnly={!manualMode || consultaProduto.status === 'carregando'}
              placeholder={consultaProduto.status === 'carregando' ? 'Consultando...' : (manualMode ? 'Digite manualmente se necessario' : '')}
              onChange={(e) => {
                preenchidoPelaApiRef.current = false;
                setLinha(e.target.value);
              }}
              onKeyDown={adicionarComEnter}
            />
          </div>
        </div>
        {manualMode && (
          <div className="novo-orcamento-adicionar">
            <span className={`novo-orcamento-pendencia${pendenciaManual ? '' : ' pronto'}`} aria-live="polite">
              {consultaProduto.status === 'carregando'
                ? 'Aguardando a consulta do produto...'
                : pendenciaManual || 'Tudo certo: tecle Enter ou clique para adicionar.'}
            </span>
            <button
              className="btn btn-success btn-sm"
              type="button"
              disabled={Boolean(pendenciaManual) || consultaProduto.status === 'carregando'}
              onClick={() => {
                if (adicionarItem()) setToast({ type: 'success', message: 'Item adicionado ao protocolo.' });
              }}
            >
              <i className="material-icons">add_circle</i> Adicionar item
            </button>
          </div>
        )}
        </>
        )}
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
                <th style={{ textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', color: '#999' }}>Nenhum item adicionado.</td>
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
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-danger btn-sm" type="button" disabled={importando} onClick={() => removerItem(item.id)}>
                      <i className="material-icons">delete</i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="action-bar" style={{ marginTop: 20 }}>
          <button
            className="btn btn-success novo-orcamento-finalizar"
            type="button"
            onClick={finalizarEnvio}
            disabled={isSaving || importando || itens.length === 0}
            title={itens.length === 0 ? 'Adicione ao menos um item para finalizar' : undefined}
          >
            <i className="material-icons">send</i>
            {isSaving ? 'ENVIANDO...' : `FINALIZAR ENVIO${itens.length ? ` (${itens.length} ${itens.length === 1 ? 'ITEM' : 'ITENS'})` : ''}`}
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
            <div className="qr-help">Aponte a camera para o QR. Se a etiqueta estiver rasurada, rasgada, suja ou ilegivel, feche esta tela e use o botao "Digitar manual".</div>
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
