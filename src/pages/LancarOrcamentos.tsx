import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { getCatalogoByLinha } from '../lib/catalogoPadrao';

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
  pecasDetalhes?: string;
  valPecas?: number;
  acessDesc?: string;
  acessDetalhes?: string;
  valAcess?: number;
  valMaoObra?: number;
  valEmb?: number;
  valHig?: number;
  totalOrcamento?: number;
  fotoNome?: string;
  defeitoFuncional?: string;
  garantia?: string;
  tipoOrc?: string;
};

type LancarOrcamentosLocationState = {
  item?: Partial<OrcamentoItem>;
};

type SetSelectionState = (updater: (current: string[]) => string[]) => void;

type DriveUploadResponse = {
  folderLink?: string;
};

type PecaComValor = {
  nome: string;
  valor: number;
};

type ItemComValor = {
  nome: string;
  valor: number;
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

const RECEM_ENVIADOS_KEY = 'gat_orc_recem_enviados';

const loadRecemEnviados = () => {
  try {
    const saved = localStorage.getItem(RECEM_ENVIADOS_KEY);
    if (!saved) return [] as OrcamentoItem[];
    const parsed = JSON.parse(saved) as OrcamentoItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveRecemEnviados = (items: OrcamentoItem[]) => {
  try {
    localStorage.setItem(RECEM_ENVIADOS_KEY, JSON.stringify(items));
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

const splitStoredSelection = (value?: string, prefix?: string) =>
  String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index) => !(prefix && index === 0 && part.toLowerCase() === prefix.toLowerCase()));

const normalizeSelectionToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const buildSelectionPayload = (values: string[], prefix?: string) => {
  const cleaned = values
    .map((value) => normalizeSelectionToken(value))
    .filter(Boolean);

  if (cleaned.length === 0) return '';
  return prefix ? `${prefix};${cleaned.join(';')}` : cleaned.join(';');
};

const parseItensComValor = (value?: unknown): ItemComValor[] => {
  if (!value) return [];

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        nome: String(item?.nome || '').trim(),
        valor: Number(item?.valor || 0)
      }))
      .filter((item) => item.nome);
  } catch {
    return [];
  }
};

const serializeItensComValor = (items: ItemComValor[]) =>
  JSON.stringify(
    items
      .map((item) => ({
        nome: item.nome.trim(),
        valor: Number(item.valor || 0)
      }))
      .filter((item) => item.nome)
  );

const buildPecasFallback = (pecasDesc?: string, valPecas?: number) => {
  const pecas = splitStoredSelection(pecasDesc, 'pe');
  if (pecas.length === 0) return [];

  return pecas.map((nome, index) => ({
    nome,
    valor: index === 0 ? Number(valPecas || 0) : 0
  }));
};

const buildAcessoriosFallback = (acessDesc?: string, valAcess?: number) => {
  const acessorios = splitStoredSelection(acessDesc, 'ac');
  if (acessorios.length === 0) return [];

  return acessorios.map((nome, index) => ({
    nome,
    valor: index === 0 ? Number(valAcess || 0) : 0
  }));
};

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
  });

const sanitizeDriveToken = (value: string, fallback: string) => {
  const cleaned = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return cleaned || fallback;
};

const buildFotoFolderName = (item: OrcamentoItem) => {
  const date = new Date();
  const timestamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('');

  return [
    'Portal_AT',
    sanitizeDriveToken(item.protocolo, 'SEM_PROTOCOLO'),
    sanitizeDriveToken(item.codGemco, 'SEM_GEMCO'),
    sanitizeDriveToken(item.serial, 'SEM_SERIAL'),
    timestamp
  ].join('_');
};

const uploadFotoDrive = async (item: OrcamentoItem, file: File) => {
  const base64 = await fileToBase64(file);
  const response = await oracleApi.post<DriveUploadResponse>(
    ORACLE_ENDPOINTS.uploadFotoDrive,
    {
      folderName: buildFotoFolderName(item),
      files: [
        {
          name: `Foto_Avaria_${sanitizeDriveToken(item.protocolo, 'SEM_PROTOCOLO')}_${file.name}`,
          mimeType: file.type || 'application/octet-stream',
          base64
        }
      ]
    },
    { headers: { 'Content-Type': 'application/json' } }
  );

  return response.data.folderLink || '';
};

const normalizeOrcamentoItem = (row: any, index: number): OrcamentoItem => ({
  id: String(row.id ?? row.ID ?? `${row.protocolo ?? row.PROTOCOLO ?? 'p'}-${index}`),
  dbId: (() => {
    const rawId = row.dbId ?? row.id ?? row.ID;
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
  status: Number(row.status ?? row.STATUS ?? 0),
  defeitoEncontrado: row.defeito_encontrado ?? row.DEFEITO_ENCONTRADO ?? row.defeitoEncontrado,
  pecasDesc: row.pecas_desc ?? row.PECAS_DESC ?? row.pecasDesc,
  pecasDetalhes: row.pecas_detalhes ?? row.PECAS_DETALHES ?? row.pecasDetalhes,
  valPecas: row.val_pecas ?? row.VAL_PECAS ?? row.valPecas,
  acessDesc: row.acess_desc ?? row.ACESS_DESC ?? row.acessDesc,
  acessDetalhes: row.acess_detalhes ?? row.ACESS_DETALHES ?? row.acessDetalhes,
  valAcess: row.val_acess ?? row.VAL_ACESS ?? row.valAcess,
  valMaoObra: row.val_mao_obra ?? row.VAL_MAO_OBRA ?? row.valMaoObra,
  valEmb: row.val_emb ?? row.VAL_EMB ?? row.valEmb,
  valHig: row.val_hig ?? row.VAL_HIG ?? row.valHig,
  totalOrcamento: row.total_orcamento ?? row.TOTAL_ORCAMENTO ?? row.totalOrcamento,
  fotoNome: row.foto_nome ?? row.FOTO_NOME ?? row.fotoNome,
  defeitoFuncional: row.defeito_funcional ?? row.DEFEITO_FUNCIONAL ?? row.defeitoFuncional,
  garantia: row.garantia ?? row.GARANTIA ?? row.garantiaPrazo,
  tipoOrc: row.tipo_orc ?? row.TIPO_ORC ?? row.tipoOrc
});

const hasLancamentoRegistrado = (item: Partial<OrcamentoItem>) =>
  Boolean(
    Number(item.status || 0) >= 2 ||
    item.totalOrcamento ||
    item.valPecas ||
    item.valAcess ||
    item.valMaoObra ||
    item.valEmb ||
    item.valHig ||
    item.defeitoEncontrado ||
    item.pecasDesc ||
    item.acessDesc ||
    item.defeitoFuncional ||
    item.garantia ||
    item.tipoOrc
  );

const applyDraftToItem = (item: OrcamentoItem, payload?: Record<string, unknown> | null): OrcamentoItem => {
  if (!payload) return item;

  return {
    ...item,
    defeitoEncontrado: typeof payload.defeitoEncontrado === 'string' ? payload.defeitoEncontrado : item.defeitoEncontrado,
    pecasDesc: typeof payload.pecasDesc === 'string' ? payload.pecasDesc : item.pecasDesc,
    pecasDetalhes: typeof payload.pecasDetalhes === 'string' ? payload.pecasDetalhes : item.pecasDetalhes,
    valPecas: typeof payload.valPecas === 'number' ? payload.valPecas : item.valPecas,
    acessDesc: typeof payload.acessDesc === 'string' ? payload.acessDesc : item.acessDesc,
    acessDetalhes: typeof payload.acessDetalhes === 'string' ? payload.acessDetalhes : item.acessDetalhes,
    valAcess: typeof payload.valAcess === 'number' ? payload.valAcess : item.valAcess,
    valMaoObra: typeof payload.valMaoObra === 'number' ? payload.valMaoObra : item.valMaoObra,
    valEmb: typeof payload.valEmb === 'number' ? payload.valEmb : item.valEmb,
    valHig: typeof payload.valHig === 'number' ? payload.valHig : item.valHig,
    totalOrcamento: typeof payload.totalOrcamento === 'number' ? payload.totalOrcamento : item.totalOrcamento,
    defeitoFuncional: typeof payload.defeitoFuncional === 'string' ? payload.defeitoFuncional : item.defeitoFuncional,
    garantia: typeof payload.garantia === 'string' ? payload.garantia : item.garantia,
    tipoOrc: typeof payload.tipoOrc === 'string' ? payload.tipoOrc : item.tipoOrc,
    fotoNome: typeof payload.fotoNome === 'string' ? payload.fotoNome : item.fotoNome,
    status: Number(payload.status ?? item.status ?? 0)
  };
};

const mergeItemIntoList = (base: OrcamentoItem[], incoming: OrcamentoItem | null) => {
  if (!incoming) return base;

  const index = base.findIndex((item) => {
    if (item.id === incoming.id) return true;
    if (item.dbId != null && incoming.dbId != null && item.dbId === incoming.dbId) return true;
    return false;
  });

  if (index === -1) {
    return [incoming, ...base];
  }

  const updated = [...base];
  updated[index] = { ...updated[index], ...incoming };
  return updated;
};

const mergeUniqueItems = (items: OrcamentoItem[]) => {
  const merged = new Map<string, OrcamentoItem>();

  items.forEach((item, index) => {
    const identityKey = buildIdentityKey(item);
    const fallbackKey = item.id || `${item.protocolo}-${index}`;
    const key = identityKey && identityKey !== '|||' ? identityKey : fallbackKey;
    const current = merged.get(key);

    merged.set(key, current ? { ...item, ...current, dbId: current.dbId ?? item.dbId } : item);
  });

  return Array.from(merged.values());
};

const buildIdentityKey = (item: Partial<OrcamentoItem>) =>
  [
    String(item.protocolo || '').trim().toUpperCase(),
    String(item.codGemco || '').trim().toUpperCase(),
    String(item.serial || '').trim().toUpperCase(),
    String(item.ean || item.codBarras || '').trim().toUpperCase()
  ].join('|');

const LancarOrcamentos = () => {
  const location = useLocation();
  const locationState = (location.state as LancarOrcamentosLocationState | null) ?? null;
  const editableItem = useMemo(
    () => (locationState?.item ? normalizeOrcamentoItem(locationState.item, 0) : null),
    [locationState]
  );
  const editSelectionAppliedRef = useRef(false);
  const draftsHydratedRef = useRef(false);
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
  const [pecaSelecionada, setPecaSelecionada] = useState('');
  const [valorPecaSelecionada, setValorPecaSelecionada] = useState(0);
  const [acessorioSelecionado, setAcessorioSelecionado] = useState('');
  const [valorAcessorioSelecionado, setValorAcessorioSelecionado] = useState(0);
  const [defeitoCatalogado, setDefeitoCatalogado] = useState('');
  const [defeitosSelecionados, setDefeitosSelecionados] = useState<string[]>([]);
  const [pecasComValores, setPecasComValores] = useState<PecaComValor[]>([]);
  const [acessoriosComValores, setAcessoriosComValores] = useState<ItemComValor[]>([]);
  const scanVideoRef = useRef<HTMLVideoElement | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const formularioRef = useRef<HTMLDivElement | null>(null);

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
  const isOrcado = (item: OrcamentoItem) =>
    Boolean(
      item.totalOrcamento ||
      item.valPecas ||
      item.valAcess ||
      item.valMaoObra ||
      item.valEmb ||
      item.valHig ||
      item.defeitoEncontrado ||
      item.pecasDesc ||
      item.acessDesc
    );
  const normalizeCode = (value: string) => value.replace(/[^0-9a-z]/gi, '').toUpperCase().trim();
  const isEditingItem = selected ? isOrcado(selected) : false;
  const catalogoLinha = useMemo(() => getCatalogoByLinha(selected?.linha), [selected?.linha]);

  const total = useMemo(
    () => valPecas + valAcess + valMaoObra + valEmb + valHig,
    [valPecas, valAcess, valMaoObra, valEmb, valHig]
  );
  const totalPecasAcess = useMemo(() => valPecas + valAcess, [valPecas, valAcess]);
  const precisaFoto = useMemo(
    () => defeitosSelecionados.some((defeito) => /AVARIA/i.test(defeito)),
    [defeitosSelecionados]
  );
  const resumoLancamento = useMemo(() => {
    const linhas: Array<{ label: string; valor: number; destaque?: boolean }> = [];

    pecasComValores.forEach((item) => {
      linhas.push({ label: item.nome, valor: item.valor });
    });

    acessoriosComValores.forEach((item) => {
      linhas.push({ label: item.nome, valor: item.valor });
    });

    if (valMaoObra > 0) {
      linhas.push({ label: 'Mão de obra', valor: valMaoObra });
    }

    if (valEmb > 0) {
      linhas.push({ label: 'Embalagem', valor: valEmb });
    }

    if (valHig > 0) {
      linhas.push({ label: 'Higienização', valor: valHig });
    }

    if (linhas.length > 0) {
      linhas.push({ label: 'Total do orçamento', valor: total, destaque: true });
    }

    return linhas;
  }, [acessoriosComValores, pecasComValores, total, valEmb, valHig, valMaoObra]);

  const preencherFormulario = (item: OrcamentoItem) => {
    const pecasDetalhadas = parseItensComValor(item.pecasDetalhes);
    const acessoriosDetalhados = parseItensComValor(item.acessDetalhes);

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
    setPecaSelecionada('');
    setValorPecaSelecionada(0);
    setAcessorioSelecionado('');
    setValorAcessorioSelecionado(0);
    setDefeitoCatalogado('');
    setDefeitosSelecionados(splitStoredSelection(item.defeitoEncontrado));
    setPecasComValores(
      pecasDetalhadas.length > 0 ? pecasDetalhadas : buildPecasFallback(item.pecasDesc, item.valPecas)
    );
    setAcessoriosComValores(
      acessoriosDetalhados.length > 0
        ? acessoriosDetalhados
        : buildAcessoriosFallback(item.acessDesc, item.valAcess)
    );
  };

  const limparFormulario = () => {
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
    setPecaSelecionada('');
    setValorPecaSelecionada(0);
    setAcessorioSelecionado('');
    setValorAcessorioSelecionado(0);
    setDefeitoCatalogado('');
    setDefeitosSelecionados([]);
    setPecasComValores([]);
    setAcessoriosComValores([]);
  };

  const selecionarItem = (item: OrcamentoItem) => {
    preencherFormulario(item);
    window.setTimeout(() => {
      formularioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

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
        setScanError('Não foi possível acessar a câmera.');
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
        const paUsuario = (localStorage.getItem('gat_user') || '').trim();
        const [res, draftsRes] = await Promise.all([
          oracleApi.get(ORACLE_ENDPOINTS.getOrcamentosAnalise, {
            params: { cnpj, _ts: Date.now() },
            responseType: 'arraybuffer',
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            validateStatus: (status) => status >= 200 && status < 400
          }),
          paUsuario
            ? oracleApi.get(ORACLE_ENDPOINTS.getLancamentoDraftsSupabase, {
                params: { paUsuario, _ts: Date.now() },
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
                validateStatus: (status) => status >= 200 && status < 500
              })
            : Promise.resolve({ data: [] })
        ]);

        const data = parseMaybeJson(res.data);
        const list: any[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];

        const draftsList = Array.isArray(draftsRes.data) ? draftsRes.data : [];
        const draftsMap = new Map<number, Record<string, unknown>>();
        draftsList.forEach((row: any) => {
          const draftItemId = Number(row?.oracle_item_id ?? 0);
          const payload = row?.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : null;
          if (draftItemId && payload) {
            draftsMap.set(draftItemId, payload);
          }
        });

        const normalized = list
          .map((row, index) => normalizeOrcamentoItem(row, index))
          .map((item) => applyDraftToItem(item, item.dbId != null ? draftsMap.get(item.dbId) ?? null : null))
          .filter((item) => !hasLancamentoRegistrado(item)) as OrcamentoItem[];

        const localPendentes = mergeUniqueItems([
          ...loadPendentes(),
          ...loadRecemEnviados()
        ]).filter((item) => !hasLancamentoRegistrado(item));

        const mergedItems = mergeUniqueItems([...normalized, ...localPendentes]);

        setItems(mergeItemIntoList(mergedItems, editableItem));
        draftsHydratedRef.current = true;
      } catch {
        const localPendentes = mergeUniqueItems([
          ...loadPendentes(),
          ...loadRecemEnviados()
        ]).filter((item) => !hasLancamentoRegistrado(item));

        setItems(mergeItemIntoList(localPendentes, editableItem));
        draftsHydratedRef.current = true;
      } finally {
        setIsLoading(false);
      }
    };

    loadFromApi();
  }, [editableItem]);

  useEffect(() => {
    if (!editableItem || editSelectionAppliedRef.current) return;
    setItems((current) => mergeItemIntoList(current, editableItem));
    selecionarItem(editableItem);
    setToast({ type: 'success', message: 'Item carregado para edição.' });
    editSelectionAppliedRef.current = true;
  }, [editableItem]);

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
      setToast({ type: 'success', message: 'Item localizado pelo código ou serial.' });
    } else {
      setToast({ type: 'error', message: 'Código ou serial não encontrado nos itens.' });
    }
  };

  const adicionarValorUnico = (
    value: string,
    setValues: SetSelectionState
  ) => {
    if (!value) return;
    setValues((current) => (current.includes(value) ? current : [...current, value]));
  };

  const removerValorSelecionado = (
    value: string,
    setValues: SetSelectionState
  ) => {
    setValues((current) => current.filter((item) => item !== value));
  };

  useEffect(() => {
    if (!catalogoLinha && pecasComValores.length === 0) return;
    setValPecas(pecasComValores.reduce((acc, item) => acc + item.valor, 0));
  }, [catalogoLinha, pecasComValores]);

  useEffect(() => {
    if (!catalogoLinha && acessoriosComValores.length === 0) return;
    setValAcess(acessoriosComValores.reduce((acc, item) => acc + item.valor, 0));
  }, [acessoriosComValores, catalogoLinha]);

  const adicionarPeca = () => {
    if (!pecaSelecionada) return;
    setPecasComValores((current) =>
      current.some((item) => item.nome === pecaSelecionada)
        ? current
        : [...current, { nome: pecaSelecionada, valor: valorPecaSelecionada }]
    );
    setPecaSelecionada('');
    setValorPecaSelecionada(0);
  };

  const adicionarAcessorio = () => {
    if (!acessorioSelecionado) return;
    setAcessoriosComValores((current) =>
      current.some((item) => item.nome === acessorioSelecionado)
        ? current
        : [...current, { nome: acessorioSelecionado, valor: valorAcessorioSelecionado }]
    );
    setAcessorioSelecionado('');
    setValorAcessorioSelecionado(0);
  };

  const adicionarDefeito = () => {
    if (!defeitoCatalogado) return;
    adicionarValorUnico(defeitoCatalogado, setDefeitosSelecionados);
    setDefeitoCatalogado('');
  };

  const removerPeca = (nome: string) => {
    setPecasComValores((current) => current.filter((item) => item.nome !== nome));
  };

  const atualizarValorPeca = (nome: string, valor: number) => {
    setPecasComValores((current) =>
      current.map((item) => (item.nome === nome ? { ...item, valor } : item))
    );
  };

  const removerAcessorio = (nome: string) => {
    setAcessoriosComValores((current) => current.filter((item) => item.nome !== nome));
  };

  const atualizarValorAcessorio = (nome: string, valor: number) => {
    setAcessoriosComValores((current) =>
      current.map((item) => (item.nome === nome ? { ...item, valor } : item))
    );
  };

  const lancarValores = async () => {
    if (!selected) return;
    if (selected.dbId == null) {
      setToast({ type: 'error', message: 'Este item não possui ID real do banco. Ajuste o endpoint para retornar o campo ID.' });
      return;
    }
    if (precisaFoto && !foto && !selected.fotoNome) {
      setToast({ type: 'error', message: 'Anexe a foto da avaria antes de lançar os valores.' });
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

      const defeitoEncontradoPayload = catalogoLinha
        ? buildSelectionPayload(defeitosSelecionados)
        : defeitoEncontrado;
      const pecasDescPayload = (catalogoLinha || pecasComValores.length > 0)
        ? buildSelectionPayload(
            pecasComValores.map((item) => item.nome),
            'pe'
          )
        : pecasDesc;
      const pecasDetalhesPayload = serializeItensComValor(pecasComValores);
      const acessDescPayload = (catalogoLinha || acessoriosComValores.length > 0)
        ? buildSelectionPayload(
            acessoriosComValores.map((item) => item.nome),
            'ac'
          )
        : acessDesc;
      const acessDetalhesPayload = serializeItensComValor(acessoriosComValores);
      const fotoLinkDrive = foto ? await uploadFotoDrive(selected, foto) : (selected.fotoNome || '');

      const submittedStatus = 2;
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
            defeitoEncontrado: defeitoEncontradoPayload,
            fotoNome: fotoLinkDrive,
            pecasDesc: pecasDescPayload,
            pecasDetalhes: pecasDetalhesPayload,
            valPecas,
            acessDesc: acessDescPayload,
            acessDetalhes: acessDetalhesPayload,
            valAcess,
            valMaoObra,
            valEmb,
            valHig,
            totalOrcamento,
            defeitoFuncional,
            garantia,
            tipoOrc,
            status: submittedStatus
          }
        ]
      };

      await oracleApi.post(ORACLE_ENDPOINTS.updateValores, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      let syncWarning = '';
      try {
        await oracleApi.post(ORACLE_ENDPOINTS.syncOrcamentoSupabase, payload, {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (syncError) {
        if (axios.isAxiosError(syncError)) {
          const syncStatus = syncError.response?.status;
          const syncData = syncError.response?.data;
          console.error('Erro ao sincronizar orcamento no Supabase:', syncStatus, syncData);
        } else {
          console.error('Erro ao sincronizar orcamento no Supabase:', syncError);
        }
        syncWarning = ' Valores salvos no portal, mas a sincronização do Supabase falhou.';
      }

      const remaining = items.filter((item) => item.id !== selected.id);
      setItems(remaining);
      savePendentes(remaining);
      saveRecemEnviados(
        loadRecemEnviados().filter((item) => buildIdentityKey(item) !== buildIdentityKey(selected))
      );
      if ((localStorage.getItem('gat_user') || '').trim() && selected.dbId != null) {
        try {
          await oracleApi.post(
            ORACLE_ENDPOINTS.saveLancamentoDraftSupabase,
            {
              paUsuario: localStorage.getItem('gat_user') || '',
              oracleItemId: selected.dbId,
              protocolo: selected.protocolo,
              cnpj,
              status: 'FINALIZADO',
              payload: {}
            },
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch {
          // ignore draft cleanup errors
        }
      }
      limparFormulario();
      setToast({
        type: syncWarning ? 'error' : 'success',
        message: `${isEditingItem ? 'Lançamento atualizado com sucesso.' : 'Valores lançados com sucesso.'}${syncWarning}`
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const data = err.response?.data;
        const backendError =
          data?.error ||
          data?.message ||
          data?.hint ||
          `Erro ao lançar valores (${status ?? 'sem status'}).`;
        setToast({ type: 'error', message: String(backendError) });
        console.error('Erro ao lancar valores do orcamento:', status, data);
      } else {
        setToast({ type: 'error', message: 'Erro ao lançar valores do orçamento.' });
        console.error('Erro ao lancar valores do orcamento:', err);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!draftsHydratedRef.current || !selected || selected.dbId == null) return;
    const paUsuario = (localStorage.getItem('gat_user') || '').trim();
    if (!paUsuario) return;

    const totalOrcamento = valPecas + valAcess + valMaoObra + valEmb + valHig;
    const draftPayload = {
      defeitoEncontrado,
      pecasDesc,
      pecasDetalhes: serializeItensComValor(pecasComValores),
      valPecas,
      acessDesc,
      acessDetalhes: serializeItensComValor(acessoriosComValores),
      valAcess,
      valMaoObra,
      valEmb,
      valHig,
      totalOrcamento,
      defeitoFuncional,
      garantia,
      tipoOrc,
      fotoNome: selected.fotoNome || '',
      status: 0
    };

    const hasDraftContent = Boolean(
      defeitoEncontrado ||
      pecasDesc ||
      acessDesc ||
      valPecas ||
      valAcess ||
      valMaoObra ||
      valEmb ||
      valHig ||
      totalOrcamento ||
      defeitoFuncional ||
      garantia ||
      tipoOrc ||
      pecasComValores.length > 0 ||
      acessoriosComValores.length > 0 ||
      defeitosSelecionados.length > 0
    );

    if (!hasDraftContent) return;

    const handle = window.setTimeout(() => {
      void oracleApi.post(
        ORACLE_ENDPOINTS.saveLancamentoDraftSupabase,
        {
          paUsuario,
          oracleItemId: selected.dbId,
          protocolo: selected.protocolo,
          cnpj: selected.cnpj || '',
          status: 'RASCUNHO',
          payload: draftPayload
        },
        { headers: { 'Content-Type': 'application/json' } }
      ).catch(() => {
        // ignore draft save errors
      });
    }, 800);

    return () => window.clearTimeout(handle);
  }, [
    selected,
    defeitoEncontrado,
    pecasDesc,
    acessDesc,
    valPecas,
    valAcess,
    valMaoObra,
    valEmb,
    valHig,
    defeitoFuncional,
    garantia,
    tipoOrc,
    pecasComValores,
    acessoriosComValores,
    defeitosSelecionados
  ]);

  return (
    <div className="view-section">
      <h2 className="page-title">Lançamento de Orçamentos</h2>

      <div className="card">
        <div className="section-title">Lotes (Protocolos)</div>
        {items.length > 0 && (
          <div className="scan-bar">
            <div className="scan-input">
              <input
                type="text"
                inputMode="numeric"
                placeholder="Bipar ou digitar código de barras/GEMCO"
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
                Bip Câmera
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
                      <th>Cód. Barras</th>
                      <th>Cod. GEMCO</th>
                      <th>Descrição</th>
                      <th>Fornecedor</th>
                      <th>Linha</th>
                      <th>Serial</th>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" ref={formularioRef}>
        <div className="section-title">{isEditingItem ? 'Editar Lançamento' : 'Valores e Defeitos'}</div>
        {!selected && (
          <div style={{ color: '#777', padding: '10px 0' }}>
            Selecione um item acima para lançar ou editar o orçamento.
          </div>
        )}
        {selected && (
          <div className="lancamento-form">
            <div className="lancamento-block">
              <label>Defeito Encontrado</label>
              {catalogoLinha ? (
                <div className="selection-stack">
                  <div className="selection-input-row">
                    <select value={defeitoCatalogado} onChange={(e) => setDefeitoCatalogado(e.target.value)}>
                      <option value="">SELECIONE O DEFEITO PADRÃO...</option>
                      {catalogoLinha.DEFEITOS.map((defeito) => (
                        <option key={defeito} value={defeito}>
                          {defeito}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-success btn-sm" type="button" onClick={adicionarDefeito}>
                      Adicionar
                    </button>
                  </div>
                  <div className="selection-tags">
                    {defeitosSelecionados.length === 0 && (
                      <div className="selection-empty">Os defeitos selecionados aparecerão abaixo.</div>
                    )}
                    {defeitosSelecionados.map((defeito) => (
                      <button
                        key={defeito}
                        type="button"
                        className="btn btn-secondary btn-sm selection-tag"
                        onClick={() => removerValorSelecionado(defeito, setDefeitosSelecionados)}
                      >
                        {defeito} ×
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <select value={defeitoEncontrado} onChange={(e) => setDefeitoEncontrado(e.target.value)}>
                  <option value="">SELECIONE...</option>
                  <option value="EMBALAGEM | HIGIENIZACAO | MAO DE OBRA">EMBALAGEM | HIGIENIZACAO | MAO DE OBRA</option>
                  <option value="DEFEITO FUNCIONAL | AVARIA ESTETICA">DEFEITO FUNCIONAL | AVARIA ESTETICA</option>
                  <option value="AVARIA ESTETICA">AVARIA ESTETICA</option>
                  <option value="DEFEITO FUNCIONAL">DEFEITO FUNCIONAL</option>
                </select>
              )}
              {precisaFoto && (
                <div style={{ marginTop: 5 }}>
                  <label style={{ color: 'var(--azul)' }}>Foto da avaria (obrigatório)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setFoto(e.target.files?.[0] || null)}
                    style={{ width: '100%' }}
                  />
                  {selected.fotoNome && !foto && (
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                      Foto atual: {selected.fotoNome}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="lancamento-row lancamento-row-3">
              <div className="lancamento-field">
                <label>Possui defeito funcional?</label>
                <select value={defeitoFuncional} onChange={(e) => setDefeitoFuncional(e.target.value)}>
                  <option value="">SELECIONE...</option>
                  <option value="SIM">SIM</option>
                  <option value="NAO">NAO</option>
                </select>
              </div>
              <div className="lancamento-field">
                <label>Dentro do prazo de garantia?</label>
                <select value={garantia} onChange={(e) => setGarantia(e.target.value)}>
                  <option value="">SELECIONE...</option>
                  <option value="SIM">SIM</option>
                  <option value="NAO">NAO</option>
                </select>
              </div>
              <div className="lancamento-field">
                <label>Tipo Orc.</label>
                <select value={tipoOrc} onChange={(e) => setTipoOrc(e.target.value)}>
                  <option value="">SELECIONE...</option>
                  <option value="SALDO A">SALDO A</option>
                  <option value="NOVO">NOVO</option>
                  <option value="SUCATA">SUCATA</option>
                </select>
              </div>
            </div>

            <div className="lancamento-main-grid">
              <div className="lancamento-selection-column">
                <div className="lancamento-block">
                  <label>Peças avariadas/faltantes</label>
                  <div className="selection-stack">
                    <div className="selection-input-row">
                      {catalogoLinha ? (
                        <select value={pecaSelecionada} onChange={(e) => setPecaSelecionada(e.target.value)}>
                          <option value="">SELECIONE A PEÇA...</option>
                          {catalogoLinha.PECAS.map((peca) => (
                            <option key={peca} value={peca}>
                              {peca}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={pecaSelecionada}
                          onChange={(e) => setPecaSelecionada(e.target.value)}
                          placeholder="Descreva a peça"
                        />
                      )}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatCurrency(valorPecaSelecionada)}
                          onChange={(e) => setValorPecaSelecionada(parseCurrency(e.target.value))}
                          placeholder="Valor"
                        />
                        <button className="btn btn-success btn-sm" type="button" onClick={adicionarPeca}>
                          Adicionar
                        </button>
                    </div>
                    <div className="selection-values-list">
                        {pecasComValores.length === 0 && (
                          <div className="selection-empty">As peças selecionadas aparecerão abaixo.</div>
                        )}
                        {pecasComValores.map((peca) => (
                          <div key={peca.nome} className="selection-value-item">
                            <div className="selection-value-name">{peca.nome}</div>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatCurrency(peca.valor)}
                              onChange={(e) => atualizarValorPeca(peca.nome, parseCurrency(e.target.value))}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => removerPeca(peca.nome)}
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>

                <div className="lancamento-block">
                  <label>Acessórios avariados/faltantes</label>
                  <div className="selection-stack">
                    <div className="selection-input-row">
                      {catalogoLinha ? (
                        <select value={acessorioSelecionado} onChange={(e) => setAcessorioSelecionado(e.target.value)}>
                          <option value="">SELECIONE O ACESSÓRIO...</option>
                          {(catalogoLinha.ACESSORIOS || ['ACESSORIO']).map((acessorio) => (
                            <option key={acessorio} value={acessorio}>
                              {acessorio}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={acessorioSelecionado}
                          onChange={(e) => setAcessorioSelecionado(e.target.value)}
                          placeholder="Descreva o acessório"
                        />
                      )}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatCurrency(valorAcessorioSelecionado)}
                          onChange={(e) => setValorAcessorioSelecionado(parseCurrency(e.target.value))}
                          placeholder="Valor"
                        />
                        <button className="btn btn-success btn-sm" type="button" onClick={adicionarAcessorio}>
                          Adicionar
                        </button>
                    </div>
                    <div className="selection-values-list">
                        {acessoriosComValores.length === 0 && (
                          <div className="selection-empty">Os acessórios selecionados aparecerão abaixo.</div>
                        )}
                        {acessoriosComValores.map((acessorio) => (
                          <div key={acessorio.nome} className="selection-value-item">
                            <div className="selection-value-name">{acessorio.nome}</div>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={formatCurrency(acessorio.valor)}
                              onChange={(e) => atualizarValorAcessorio(acessorio.nome, parseCurrency(e.target.value))}
                            />
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => removerAcessorio(acessorio.nome)}
                            >
                              Remover
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="lancamento-values-column resumo-financeiro" aria-label="Resumo financeiro do orçamento">
                <div className="resumo-financeiro-titulo">
                  <span>Resumo financeiro</span>
                  <small>Os totais de peças e acessórios são calculados automaticamente.</small>
                </div>
                <div className="lancamento-row lancamento-row-2">
                  <div className="lancamento-field">
                    <label>Valor das peças</label>
                    <input type="text" readOnly value={formatCurrency(valPecas)} className="calculated-value" aria-label="Valor das peças calculado automaticamente" />
                  </div>
                  <div className="lancamento-field">
                    <label>Valor dos acessórios</label>
                    <input type="text" readOnly value={formatCurrency(valAcess)} className="calculated-value" aria-label="Valor dos acessórios calculado automaticamente" />
                  </div>
                </div>

                <div className="lancamento-row lancamento-row-3">
                  <div className="lancamento-field"><label>Mão de obra</label><input type="text" inputMode="decimal" value={formatCurrency(valMaoObra)} onChange={(e) => setValMaoObra(parseCurrency(e.target.value))} /></div>
                  <div className="lancamento-field"><label>Embalagem</label><input type="text" inputMode="decimal" value={formatCurrency(valEmb)} onChange={(e) => setValEmb(parseCurrency(e.target.value))} /></div>
                  <div className="lancamento-field"><label>Higienização</label><input type="text" inputMode="decimal" value={formatCurrency(valHig)} onChange={(e) => setValHig(parseCurrency(e.target.value))} /></div>
                </div>

                <div className="lancamento-row lancamento-row-1">
                  <div className="lancamento-field">
                    <label>Total de peças e acessórios</label>
                    <input type="text" readOnly value={formatCurrency(totalPecasAcess)} className="calculated-value" />
                  </div>
                </div>

                <div className="lancamento-row lancamento-row-1">
                  <div className="lancamento-field">
                    <label>Total do orçamento</label>
                    <input type="text" readOnly value={formatCurrency(total)} className="total-display" />
                  </div>
                </div>
              </aside>
            </div>

            {resumoLancamento.length > 0 && (
              <div className="lancamento-block resumo-lancamento">
                <label>Conferência rápida</label>
                <div className="resumo-lista">
                  {resumoLancamento.map((item) => (
                    <div
                      key={`${item.label}-${item.valor}-${item.destaque ? 'd' : 'n'}`}
                      className={`resumo-item${item.destaque ? ' resumo-item-total' : ''}`}
                    >
                      <span>{item.label}</span>
                      <strong>{formatCurrency(item.valor)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {selected && (
          <div className="action-bar">
            <button className="btn btn-success btn-sm" type="button" onClick={lancarValores} disabled={isSubmitting}>
              <i className="material-icons">save</i> {isSubmitting ? (isEditingItem ? 'SALVANDO...' : 'LANÇANDO...') : (isEditingItem ? 'SALVAR EDIÇÃO' : 'LANÇAR VALORES')}
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
              <h3>Bip por Câmera</h3>
              <button type="button" className="qr-close" onClick={() => setIsScanning(false)}>x</button>
            </div>
            <div className="qr-video-wrap">
              <video ref={scanVideoRef} className="qr-video" muted playsInline />
            </div>
            {scanError && <div className="qr-error">{scanError}</div>}
            <div className="qr-help">Aponte a câmera para o código de barras.</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LancarOrcamentos;
