import { useEffect, useRef, useState } from 'react';
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
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestSeqRef = useRef(0);
  const pendingScanRef = useRef<ParsedQrPayload | null>(null);
  const serialInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const draftHydratedRef = useRef(false);
  const serialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupInFlightRef = useRef('');

  const gerarProtocolo = () => {
    const now = new Date();
    return `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
  };

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  const compactLookupValue = (value: string) =>
    value.replace(/[^0-9a-z]/gi, '').toUpperCase().trim();

  const parseSerialPayload = (raw: string) => {
    const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
    if (!cleaned) return '';

    if (cleaned.startsWith('{')) {
      try {
        const parsed = JSON.parse(cleaned);
        const serialValue =
          parsed?.serial
          ?? parsed?.SERIAL
          ?? parsed?.sn
          ?? parsed?.SN
          ?? parsed?.serialNumber
          ?? parsed?.serial_number
          ?? parsed?.imei
          ?? parsed?.IMEI;

        if (serialValue) {
          return String(serialValue);
        }
      } catch {
        // ignore malformed JSON and continue with plain-text parsing
      }
    }

    const labelMatch = cleaned.match(/(?:serial(?:number)?|sn|imei)[^0-9a-z]*([0-9a-z-]+)/i);
    if (labelMatch?.[1]) {
      return labelMatch[1];
    }

    return cleaned;
  };

  const formatSerialValue = (raw: string) => {
    const compact = compactLookupValue(parseSerialPayload(raw));
    if (!compact) return '';
    if (compact.length <= 4) return compact;
    return compact.match(/.{1,4}/g)?.join('-') ?? compact;
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

    const loadDraftFromSupabase = async () => {
      const paUsuario = (localStorage.getItem('gat_user') || '').trim();
      if (!paUsuario) {
        setProtocolo(gerarProtocolo());
        return;
      }

      try {
        const response = await oracleApi.get(ORACLE_ENDPOINTS.getOrcamentoDraftSupabase, {
          params: { paUsuario, _ts: Date.now() },
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          validateStatus: (status) => status >= 200 && status < 500
        });

        const rows = Array.isArray(response.data) ? response.data : [];
        const row = rows[0];
        const draft = row?.payload && typeof row.payload === 'object'
          ? row.payload as Partial<{
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
      await loadDraftFromSupabase();
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
      void oracleApi.post(
        ORACLE_ENDPOINTS.saveOrcamentoDraftSupabase,
        {
          paUsuario,
          cnpj,
          protocolo,
          status: 'RASCUNHO',
          payload: {
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
          }
        },
        { headers: { 'Content-Type': 'application/json' } }
      ).catch(() => {
        // silencioso: mantem a tela responsiva se o rascunho falhar
      });
    }, 800);

    return () => window.clearTimeout(handle);
  }, [protocolo, cnpj, razaoSocial, email, unidade, uuid, ean, codGemco, descProd, fornecedor, linha, serial, itens]);

  useEffect(() => {
    if (!showQr) return;
    let cancelled = false;
    let frameId = 0;
    let stream: MediaStream | null = null;

    const start = async () => {
      try {
        setQrError('');
        if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
          setQrError('Este navegador não permite o acesso à câmera.');
          return;
        }

        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) {
          setQrError('Leitura por câmera não é suportada neste navegador. Abra pelo Chrome atualizado ou use o preenchimento manual.');
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
        if (cancelled) return;

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
              if (value) {
                handleQrInput(value);
                setShowQr(false);
                return;
              }
            } catch {
              // A câmera pode ainda estar ajustando foco/exposição; tenta novamente.
            }
          }
          frameId = requestAnimationFrame(scan);
        };
        frameId = requestAnimationFrame(scan);
      } catch (error) {
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

  const alternarPreenchimentoManual = () => {
    setManualMode((prev) => {
      const next = !prev;
      if (next) {
        requestAnimationFrame(() => codeInputRef.current?.focus());
      }
      return next;
    });
    pendingScanRef.current = null;
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

    if (!validarDadosItem({
      serial: finalSerial,
      codGemco: finalCodGemco,
      descricao: finalDesc
    })) {
      return;
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
    serialInputRef.current?.focus();
  };

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
        await oracleApi.post(
          ORACLE_ENDPOINTS.saveOrcamentoDraftSupabase,
          {
            paUsuario: localStorage.getItem('gat_user') || '',
            cnpj,
            protocolo,
            status: 'FINALIZADO',
            payload: {}
          },
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch {
        // ignore remote draft cleanup errors
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
        <div className="novo-orcamento-help">
          Campos com * sao obrigatorios. Se a etiqueta estiver rasurada, rasgada, suja ou ilegivel, use o botao de preenchimento manual.
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
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  finalizeSerialInput((e.currentTarget as HTMLInputElement).value);
                }
              }}
              onBlur={(e) => finalizeSerialInput(e.target.value)}
            />
          </div>
          <div className="span-5 novo-orcamento-gemco-field">
            <label>Código GEMCO *</label>
            <div className="qr-input-group novo-orcamento-qr-group">
              <input
                ref={codeInputRef}
                type="text"
                value={codGemco}
                disabled={!serialPronto && !manualMode}
                required
                placeholder={manualMode ? 'Digite o Código GEMCO' : (serialPronto ? 'Bipe o código/QR' : 'Preencha o serial antes')}
                onChange={(e) => {
                  const value = e.target.value;
                  requestSeqRef.current += 1;
                  setCodGemco(value);
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
              <button
                className="btn btn-secondary btn-sm novo-orcamento-qr-button"
                type="button"
                onClick={alternarPreenchimentoManual}
              >
                {manualMode ? 'Fechar manual' : 'Digitar manual'}
              </button>
            </div>
          </div>
          <div className="span-2">
            <label>ID Unico</label>
            <input
              type="text"
              value={uuid}
              readOnly={!manualMode}
              placeholder={manualMode ? 'Digite manualmente se necessario' : ''}
              onChange={(e) => setUuid(sanitizeUuidValue(e.target.value))}
            />
          </div>
          <div className="span-2">
            <label>Código de Barras</label>
            <input
              type="text"
              value={ean}
              readOnly={!manualMode}
              placeholder={manualMode ? 'Digite manualmente se necessario' : ''}
              onChange={(e) => setEan(sanitizeEanValue(e.target.value))}
            />
          </div>
          <div className="span-6">
            <label>Descrição *</label>
            <input
              type="text"
              value={descProd}
              readOnly={!manualMode}
              required
              placeholder={manualMode ? 'Obrigatorio preencher' : ''}
              onChange={(e) => setDescProd(e.target.value)}
            />
          </div>
          <div className="span-3">
            <label>Fornecedor</label>
            <input
              type="text"
              value={fornecedor}
              readOnly={!manualMode}
              placeholder={manualMode ? 'Digite manualmente se necessario' : ''}
              onChange={(e) => setFornecedor(e.target.value)}
            />
          </div>
          <div className="span-3">
            <label>Linha</label>
            <input
              type="text"
              value={linha}
              readOnly={!manualMode}
              placeholder={manualMode ? 'Digite manualmente se necessario' : ''}
              onChange={(e) => setLinha(e.target.value)}
            />
          </div>
        </div>
      </div>

      {manualMode && <button className="btn btn-success" type="button" onClick={() => adicionarItem()}>Adicionar item manual</button>}

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
