import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStatusLabel, isLoteFinalizado } from '../lib/statusMap';
import AcaoLotePosto from '../components/AcaoLotePosto';
import { resultadoItem, valorFinalItem, valorAceito } from '../lib/resultadoOrcamento';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

type ItemEnvio = {
  envioRecebido?: boolean;
  envioFinalizado?: boolean;
  orcamentoPronto?: boolean;
  negociacaoAplicada?: boolean;
  id: string;
  dbId?: number;
  protocolo: string;
  codBarras: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  status: number;
  supabaseId?: string;
  statusText?: string | null;
  retificacao?: { motivo: string; responsavel: string; data: string; original?: { total_orcamento?: number } } | null;
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
  fotoNome?: string;
  defeitoFuncional?: string;
  garantia?: string;
  tipoOrc?: string;
  cnpj?: string;
  razaoSocial?: string;
  unidade?: string;
  emailRetorno?: string;
  uuid?: string;
  ean?: string;
};

type StatusSupabaseRow = {
  envio_finalizado?: boolean;
  orcamento_pronto?: boolean;
  negociacao_aplicada?: boolean;
  retificacao?: ItemEnvio['retificacao'];
  id?: number | string | null;
  status_text?: string | null;
  total_orcamento?: number | string | null;
  oracle_item_id?: number | string | null;
  protocolo?: string | null;
  cod_gemco?: string | null;
  cod_barras?: string | null;
  serial?: string | null;
  status?: number | string | null;
};

type NegociacaoSupabaseRow = {
  id?: number | string | null;
  protocolo?: string | null;
  cnpj?: string | null;
  negotiation_scope?: string | null;
  item_ids?: string[] | null;
  valor_original?: number | string | null;
  valor_proposto_at?: number | string | null;
  valor_contraproposta_posto?: number | string | null;
  observacao_at?: string | null;
  observacao_posto?: string | null;
  email_destino?: string | null;
  status?: string | null;
  acao_pendente_de?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  criado_por?: string | null;
  respondido_por?: string | null;
};

// Visual da tela (prefixo me-). Sóbrio: bordas finas, pouca cor, cor só onde pede ação.
const estiloMeusEnvios = `
.me-page { --me-borda: #e5e7eb; --me-texto: #1f2937; --me-muted: #6b7280; --me-fundo: #f9fafb; --me-azul: var(--azul-escuro, #0056b3); }
.me-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.me-titulo { margin: 0 !important; padding: 0 !important; border: 0 !important; }
.me-subtitulo { margin: 3px 0 0; font-size: .88rem; color: var(--me-muted); }

.me-btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid var(--me-borda); border-radius: 6px; background: #fff; color: var(--me-texto); font: inherit; font-size: .84rem; font-weight: 500; cursor: pointer; white-space: nowrap; }
.me-btn:hover:not(:disabled) { border-color: #c7ccd4; background: var(--me-fundo); }
.me-btn:disabled { opacity: .6; cursor: default; }
.me-btn .material-icons { font-size: 17px; }
.me-btn-sm { height: 28px; padding: 0 9px; font-size: .78rem; }
.me-btn-sm .material-icons { font-size: 15px; }
.me-girando { animation: me-girar .9s linear infinite; }

.me-busca { position: relative; display: flex; align-items: center; margin-bottom: 12px; max-width: 420px; }
.me-busca > .material-icons { position: absolute; left: 10px; font-size: 19px; color: #9ca3af; pointer-events: none; }
.me-busca input { height: 38px; padding: 0 34px 0 36px; border-radius: 6px; border: 1px solid var(--me-borda); font-size: .88rem; background: #fff; }
.me-busca input:focus { border-color: var(--me-azul); box-shadow: 0 0 0 3px rgba(0,86,179,.1); }
.me-busca-limpar { position: absolute; right: 6px; width: 26px; height: 26px; border: 0; background: none; color: #9ca3af; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.me-busca-limpar:hover { color: var(--me-texto); background: var(--me-fundo); }
.me-busca-limpar .material-icons { font-size: 17px; }

.me-estado { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 16px; color: var(--me-muted); font-size: .9rem; text-align: center; }
.me-estado[role="status"] { flex-direction: row; justify-content: center; }
.me-vazio { border: 1px dashed var(--me-borda); border-radius: 8px; background: #fff; }
.me-vazio > .material-icons { font-size: 34px; color: #c3c8d0; }
.me-vazio p { margin: 0; }
.me-erro { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #f3c2c6; background: #fdf2f2; color: #8a1c24; border-radius: 6px; font-size: .86rem; }
.me-erro > span { flex: 1; min-width: 200px; }
.me-spinner { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: me-girar .8s linear infinite; display: inline-block; }
@keyframes me-girar { to { transform: rotate(360deg); } }

.me-lote { border: 1px solid var(--me-borda) !important; border-radius: 8px !important; box-shadow: none !important; margin-bottom: 10px !important; }
.me-lote.pronto-finalizar, .me-lote.me-lote-acao { border-left: 1px solid var(--me-borda) !important; }
.me-lote-cab { padding: 12px 16px !important; }
.me-lote-cab:focus-visible { outline: 2px solid var(--me-azul); outline-offset: -2px; }
.me-lote-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.me-lote-protocolo { font-weight: 700; font-size: .98rem; color: var(--me-texto); font-family: ui-monospace, Consolas, monospace; letter-spacing: .2px; }
.me-lote-meta { font-size: .82rem; color: var(--me-muted); }
.me-lote-meta strong { color: var(--me-texto); font-weight: 600; }
.me-sep { margin: 0 6px; color: #c3c8d0; }
.me-lote-chamada { font-size: .8rem; color: #1e7b3c; font-weight: 600; }
.me-lote-chamada.negociacao { color: #a15c00; }
.me-link-lancar { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.me-lote-dir { gap: 12px !important; }
.me-status { display: inline-flex; align-items: center; gap: 7px; font-size: .82rem; color: var(--me-texto); white-space: nowrap; }
.me-status-ponto { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.me-lote-corpo { background: #fff !important; padding: 14px 16px 16px !important; }
.me-resumo { display: flex; flex-wrap: wrap; gap: 8px 32px; margin: 0 0 14px; padding-bottom: 12px; border-bottom: 1px solid var(--me-borda); }
.me-resumo dt { font-size: .76rem; color: var(--me-muted); }
.me-resumo dd { margin: 1px 0 0; font-size: .95rem; font-weight: 600; color: var(--me-texto); }
.me-resumo-resultado dd { font-weight: 500; font-size: .88rem; }
.me-nota { margin: -6px 0 12px; font-size: .8rem; color: var(--me-muted); }
.me-alerta-amarelo { display: flex; flex-direction: column; gap: 3px; margin-bottom: 12px; padding: 10px 12px; border: 1px solid #f5d9a8; background: #fffaf0; color: #8a4b08; border-radius: 6px; font-size: .84rem; }

.me-tabela-wrap { border: 1px solid var(--me-borda) !important; border-radius: 6px !important; margin-bottom: 0 !important; }
.me-tabela { font-size: .82rem; }
.me-tabela th { background: var(--me-fundo) !important; color: var(--me-muted) !important; text-transform: none !important; font-weight: 600 !important; font-size: .76rem; padding: 9px 12px !important; border-right: 0 !important; border-bottom: 1px solid var(--me-borda) !important; white-space: nowrap; }
.me-tabela td { padding: 9px 12px !important; border-right: 0 !important; border-bottom: 1px solid #f0f1f3 !important; vertical-align: top; color: var(--me-texto); }
.me-tabela tbody tr:last-child td { border-bottom: 0 !important; }
.me-tabela tbody tr:hover td { background: #fafbfc; }
.me-num { text-align: right !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
.me-mono { font-family: ui-monospace, Consolas, monospace; font-size: .78rem; white-space: nowrap; }
.me-produto { min-width: 220px; max-width: 320px; }
.me-produto strong { display: block; }
.me-produto span { display: block; color: var(--me-muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.me-resultado { white-space: nowrap; font-weight: 600; }
.me-resultado-aprovado { color: #1e7b3c; }
.me-resultado-reprovado { color: #b42318; }
.me-resultado-retificado { color: #a15c00; }
.me-resultado-aguardandoanalise { color: var(--me-muted); font-weight: 500; }
.me-retificacao { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; font-size: .74rem; color: var(--me-muted); white-space: nowrap; }
.me-status-item { min-width: 130px; }

@media (max-width: 640px) {
  .me-busca { max-width: none; }
  .me-topo .me-btn { width: 100%; justify-content: center; }
  .me-resumo { gap: 8px 20px; }
}
`;

const normalizeProtocolKey = (value?: string | null) =>
  String(value || '')
    .trim()
    .toUpperCase();

const buildItemKey = (item: Partial<ItemEnvio>) =>
  [
    String(item.protocolo || '').trim().toUpperCase(),
    String(item.codGemco || '').trim().toUpperCase(),
    String(item.serial || '').trim().toUpperCase(),
    String(item.ean || item.codBarras || '').trim().toUpperCase()
  ].join('|');

const hasNegociacaoPendente = (item: Partial<ItemEnvio>) => Number(item.status || 0) === 7;

// O lote só pode ser liberado para o AT enquanto ainda está em montagem.
// "Pendente" (status 0) já significa que ele foi finalizado pelo posto e
// está na fila da análise orçamentária.
const isItemEmMontagem = (item: Partial<ItemEnvio>) =>
  Number(item.status) === 8 || String(item.statusText || '').trim().toUpperCase() === 'MONTAGEM';

const isItemEmEnvio = (item: Partial<ItemEnvio>) =>
  Boolean(
    [2, 8, 3, 7, 4, 10].includes(Number(item.status || 0)) ||
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

const normalizeEnvioItem = (row: any, index: number): ItemEnvio => ({
  envioRecebido: row.envio_recebido,
  id: String(row.id ?? row.ID ?? `${row.protocolo ?? row.PROTOCOLO ?? 'p'}-${index}`),
  dbId: (() => {
    const rawId = row.id ?? row.ID ?? row.dbId ?? row.oracle_item_id ?? row.ORACLE_ITEM_ID;
    if (rawId === null || rawId === undefined || rawId === '') return undefined;
    const parsed = Number(rawId);
    return Number.isFinite(parsed) ? parsed : undefined;
  })(),
  protocolo: String(row.protocolo ?? row.PROTOCOLO ?? ''),
  codBarras: String(row.cod_barras ?? row.COD_BARRAS ?? row.codBarras ?? row.ean ?? row.EAN ?? ''),
  codGemco: String(row.cod_gemco ?? row.COD_GEMCO ?? row.codGemco ?? ''),
  descricao: String(row.descricao ?? row.DESCRICAO ?? ''),
  fornecedor: String(row.fornecedor ?? row.FORNECEDOR ?? ''),
  linha: String(row.linha ?? row.LINHA ?? ''),
  serial: String(row.serial ?? row.SERIAL ?? ''),
  status: Number(row.status ?? row.STATUS ?? 0),
  criadoEm: String(row.criado_em ?? row.CRIADO_EM ?? row.criadoEm ?? ''),
  totalOrcamento: row.total_orcamento ?? row.TOTAL_ORCAMENTO ?? row.totalOrcamento,
  valPecas: row.val_pecas ?? row.VAL_PECAS ?? row.valPecas,
  valAcess: row.val_acess ?? row.VAL_ACESS ?? row.valAcess,
  valMaoObra: row.val_mao_obra ?? row.VAL_MAO_OBRA ?? row.valMaoObra,
  valEmb: row.val_emb ?? row.VAL_EMB ?? row.valEmb,
  valHig: row.val_hig ?? row.VAL_HIG ?? row.valHig,
  defeitoEncontrado: row.defeito_encontrado ?? row.DEFEITO_ENCONTRADO ?? row.defeitoEncontrado,
  pecasDesc: row.pecas_desc ?? row.PECAS_DESC ?? row.pecasDesc,
  acessDesc: row.acess_desc ?? row.ACESS_DESC ?? row.acessDesc,
  fotoNome: row.foto_nome ?? row.FOTO_NOME ?? row.fotoNome,
  defeitoFuncional: row.defeito_funcional ?? row.DEFEITO_FUNCIONAL ?? row.defeitoFuncional,
  garantia: row.garantia ?? row.GARANTIA ?? row.garantiaPrazo,
  tipoOrc: row.tipo_orc ?? row.TIPO_ORC ?? row.tipoOrc,
  cnpj: String(row.cnpj ?? row.CNPJ ?? ''),
  razaoSocial: String(row.razao_social ?? row.RAZAO_SOCIAL ?? row.razaoSocial ?? ''),
  unidade: String(row.unidade ?? row.UNIDADE ?? ''),
  emailRetorno: String(row.email_retorno ?? row.EMAIL_RETORNO ?? row.emailRetorno ?? ''),
  uuid: String(row.uuid ?? row.UUID ?? ''),
  ean: String(row.ean ?? row.EAN ?? row.cod_barras ?? row.COD_BARRAS ?? row.codBarras ?? '')
});

const MeusEnvios = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [filtroTexto, setFiltroTexto] = useState('');
  const [aba, setAba] = useState<'andamento' | 'finalizados'>('andamento');
  useEffect(() => {
    const protocolo = searchParams.get('protocolo') || '';
    setFiltroTexto(protocolo);
    if (protocolo) setAbertos((atual) => ({ ...atual, [protocolo]: true }));
  }, [searchParams]);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<ItemEnvio[]>([]);
  const [cnpjPosto, setCnpjPosto] = useState('');
  const [idsLotePorProtocolo, setIdsLotePorProtocolo] = useState<Record<string, string[]>>({});
  const [totalItensByProtocolo, setTotalItensByProtocolo] = useState<Record<string, number>>({});
  const [negociacoesByProtocolo, setNegociacoesByProtocolo] = useState<Record<string, NegociacaoSupabaseRow>>({});
  const [contraValores, setContraValores] = useState<Record<string, string>>({});
  const [contraObs, setContraObs] = useState<Record<string, string>>({});
  const [respondendo, setRespondendo] = useState<Record<string, boolean>>({});
  const [contraAberta, setContraAberta] = useState<Record<string, boolean>>({});
  const [avisoNegociacao, setAvisoNegociacao] = useState<Record<string, { tipo: 'sucesso' | 'erro'; texto: string } | undefined>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const respostasEmAndamentoRef = useRef(0);

  const carregar = useCallback(async (automatico = false) => {
    if (requestRef.current || respostasEmAndamentoRef.current > 0) return;
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      if (!automatico) setIsLoading(true);
      setLoadError('');
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
            signal: controller.signal,
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

      if (!cnpj) throw new Error('CNPJ não encontrado.');
      setCnpjPosto(cnpj.replace(/\D/g, ''));
      // getEnvios ja e a leitura do Supabase. Nao chame a mesma consulta uma
      // segunda vez pelo endpoint de status: isso atrasava a pagina e podia
      // concorrer com a finalizacao do lote.
      const [res, negociacoesRes] = await Promise.all([
        oracleApi.get(ORACLE_ENDPOINTS.getEnvios, {
          signal: controller.signal,
          params: { cnpj, _ts: Date.now() },
          responseType: 'arraybuffer',
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          validateStatus: (status) => status >= 200 && status < 400
        }),
        oracleApi.get(ORACLE_ENDPOINTS.getEnviosNegociacoesSupabase, {
          signal: controller.signal,
          params: { cnpj, _ts: Date.now() },
          validateStatus: (status) => status >= 200 && status < 500
        })
      ]);

      const data = parseMaybeJson(res.data);
      const list: any[] = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];

      const supaList: StatusSupabaseRow[] = list;
      const idsPorProtocolo: Record<string, string[]> = {};
      supaList.forEach((row) => {
        const protocolo = normalizeProtocolKey(row.protocolo);
        const id = String(row.oracle_item_id ?? '').trim();
        if (protocolo && /^\d+$/.test(id)) (idsPorProtocolo[protocolo] ||= []).push(id);
      });

      const statusByOracleId = new Map<number, StatusSupabaseRow>();
      const statusByKey = new Map<string, StatusSupabaseRow>();

      supaList.forEach((row) => {
        const rawStatus = Number(row.status ?? 0);
        if (!Number.isFinite(rawStatus)) return;

        const oracleItemId = Number(row.oracle_item_id);
        if (Number.isFinite(oracleItemId) && oracleItemId > 0) {
          if (!statusByOracleId.has(oracleItemId)) statusByOracleId.set(oracleItemId, row);
        }

        const key = buildItemKey({
          protocolo: String(row.protocolo ?? ''),
          codGemco: String(row.cod_gemco ?? ''),
          codBarras: String(row.cod_barras ?? ''),
          serial: String(row.serial ?? '')
        });
        if (key !== '|||') {
          if (!statusByKey.has(key)) statusByKey.set(key, row);
        }
      });

      const negociacoesRaw = negociacoesRes.data;
      if (negociacoesRes.status >= 400 || (!Array.isArray(negociacoesRaw) && !Array.isArray(negociacoesRaw?.items))) {
        throw new Error('Falha ao consultar os valores negociados.');
      }
      const negociacoesList: NegociacaoSupabaseRow[] = Array.isArray(negociacoesRaw)
        ? negociacoesRaw
        : Array.isArray(negociacoesRaw?.items)
          ? negociacoesRaw.items
          : [];

      const nextNegociacoesByProtocolo: Record<string, NegociacaoSupabaseRow> = {};
      negociacoesList.forEach((row) => {
        const protocolo = normalizeProtocolKey(row.protocolo);
        if (!protocolo || nextNegociacoesByProtocolo[protocolo]) return;
        nextNegociacoesByProtocolo[protocolo] = row;
      });

      const normalized = list.map((row, index) => normalizeEnvioItem(row, index)).map((item) => {
        const statusById = item.dbId != null ? statusByOracleId.get(item.dbId) : undefined;
        const statusByComposite = statusByKey.get(buildItemKey(item));
        const atual = statusById ?? statusByComposite;

        return {
          ...item,
          envioFinalizado: atual?.envio_finalizado,
          orcamentoPronto: atual?.orcamento_pronto,
          dbId: atual?.oracle_item_id != null ? Number(atual.oracle_item_id) : item.dbId,
          status: Number(atual?.status ?? item.status ?? 0),
          statusText: atual?.status_text,
          negociacaoAplicada: atual?.negociacao_aplicada,
          retificacao: atual?.retificacao,
          supabaseId: atual?.id != null ? String(atual.id) : undefined,
          totalOrcamento: atual?.total_orcamento != null ? Number(atual.total_orcamento) : item.totalOrcamento
        };
      }) as ItemEnvio[];

      const mergedItems = normalized;

      const totais: Record<string, number> = {};
      mergedItems.forEach((item) => {
        const protocolo = normalizeProtocolKey(item.protocolo);
        if (!protocolo) return;
        totais[protocolo] = (totais[protocolo] || 0) + 1;
      });

      if (controller.signal.aborted) return;
      setTotalItensByProtocolo(totais);
      setIdsLotePorProtocolo(idsPorProtocolo);
      setItems(mergedItems.filter(isItemEmEnvio));
      setNegociacoesByProtocolo(nextNegociacoesByProtocolo);
    } catch {
      if (controller.signal.aborted) return;
      setLoadError('Não foi possível atualizar os envios. Os dados exibidos podem estar desatualizados.');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void carregar();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [carregar]);

  const grupos = useMemo(() => {
    const map = new Map<string, ItemEnvio[]>();
    items.forEach((item) => {
      const key = normalizeProtocolKey(item.protocolo) || 'SEM PROTOCOLO';
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    });
    return Array.from(map.entries());
  }, [items]);

  const gruposPorAba = useMemo(() => {
    const termo = filtroTexto.trim().toLowerCase();
    const andamento: [string, ItemEnvio[]][] = [];
    const finalizados: [string, ItemEnvio[]][] = [];
    grupos
      .filter(([protocolo]) => !termo || protocolo.toLowerCase().includes(termo))
      .forEach((grupo) => {
        const [protocolo, itens] = grupo;
        (isLoteFinalizado(itens, totalItensByProtocolo[protocolo] || itens.length) ? finalizados : andamento).push(grupo);
      });
    return { andamento, finalizados };
  }, [filtroTexto, grupos, totalItensByProtocolo]);

  const filtrados = gruposPorAba[aba];
  const outraAba = aba === 'andamento' ? 'finalizados' : 'andamento';

  // Link direto para um protocolo (?protocolo=): abre a aba onde ele esta.
  // Feito uma vez por link, para nao desfazer a troca manual de aba ao atualizar a lista.
  const abaDoLinkRef = useRef('');
  useEffect(() => {
    const protocolo = normalizeProtocolKey(searchParams.get('protocolo') || '');
    if (!protocolo || abaDoLinkRef.current === protocolo) return;
    const destino = gruposPorAba.finalizados.some(([chave]) => chave === protocolo)
      ? 'finalizados'
      : gruposPorAba.andamento.some(([chave]) => chave === protocolo) ? 'andamento' : null;
    if (!destino) return;
    abaDoLinkRef.current = protocolo;
    setAba(destino);
  }, [searchParams, gruposPorAba]);

  const statusCor = (status: number) => {
    if (status === 4 || status === 10) return 'var(--status-finalizado)';
    if (status === 7) return 'var(--status-pendente)';
    if (status === 2 || status === 3 || status === 8) return 'var(--status-andamento)';
    return 'var(--status-pendente)';
  };

  const formatCurrency = (value?: number | string | null) => {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return '-';
    return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const valorPositivo = (value?: number | string | null) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  };

  const parseCurrencyInput = (value: string) => {
    const normalized = value.replace(/[^\d,.-]/g, '').trim();
    if (!normalized) return 0;
    const numeric = normalized.includes(',')
      ? Number(normalized.replace(/\./g, '').replace(',', '.'))
      : Number(normalized);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  const formatCurrencyInput = (value?: number | string | null) => {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) && numeric > 0
      ? numeric.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '';
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-';
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString('pt-BR', { hour12: false });
  };

  const getNegociacaoStatusLabel = (status?: string | null) => {
    const normalized = String(status || '').trim().toUpperCase();
    if (normalized === 'ABERTA_AT') return 'Aguardando sua resposta';
    if (normalized === 'ACEITA_POSTO') return 'Proposta aceita';
    if (normalized === 'RECUSADA_POSTO') return 'Proposta recusada';
    if (normalized === 'CONTRAPROPOSTA_POSTO') return 'Contraproposta enviada';
    return normalized || 'Negociação em andamento';
  };

  const responderNegociacao = async (
    protocolo: string,
    action: 'ACEITAR' | 'RECUSAR' | 'CONTRAPROPOSTA'
  ) => {
    const negociacao = negociacoesByProtocolo[protocolo];
    if (!negociacao) return;

    const valorContraproposta = parseCurrencyInput(contraValores[protocolo] || '');
    if (action === 'CONTRAPROPOSTA' && (!Number.isFinite(valorContraproposta) || valorContraproposta <= 0)) {
      setAvisoNegociacao((prev) => ({ ...prev, [protocolo]: { tipo: 'erro', texto: 'Informe o valor da contraproposta.' } }));
      return;
    }
    if (action === 'ACEITAR' && !window.confirm(`Aceitar a proposta de ${formatCurrency(negociacao.valor_proposto_at)} do AT?`)) return;
    if (action === 'RECUSAR' && !window.confirm('Recusar a proposta do AT? O AT será avisado da recusa.')) return;

    setAvisoNegociacao((prev) => ({ ...prev, [protocolo]: undefined }));
    try {
      respostasEmAndamentoRef.current += 1;
      requestRef.current?.abort();
      setRespondendo((prev) => ({ ...prev, [protocolo]: true }));
      const response = await oracleApi.post(
        ORACLE_ENDPOINTS.postEnvioNegociacaoResposta,
        {
          protocolo,
          action,
          valorContraproposta,
          observacaoPosto: contraObs[protocolo] || '',
          respondidoPor: localStorage.getItem('gat_user') || ''
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const updatedRows = Array.isArray(response.data) ? response.data : [];
      const updated = updatedRows[0] || {
        ...negociacao,
        status:
          action === 'ACEITAR'
            ? 'ACEITA_POSTO'
            : action === 'RECUSAR'
              ? 'RECUSADA_POSTO'
              : 'CONTRAPROPOSTA_POSTO',
        acao_pendente_de: 'AT',
        valor_contraproposta_posto: action === 'CONTRAPROPOSTA' ? valorContraproposta : negociacao.valor_contraproposta_posto,
        observacao_posto: contraObs[protocolo] || '',
        respondido_por: localStorage.getItem('gat_user') || '',
        updated_at: new Date().toISOString()
      };

      setNegociacoesByProtocolo((prev) => ({ ...prev, [protocolo]: updated }));
      setContraValores((prev) => ({ ...prev, [protocolo]: '' }));
      setContraObs((prev) => ({ ...prev, [protocolo]: '' }));
      setContraAberta((prev) => ({ ...prev, [protocolo]: false }));
      setAvisoNegociacao((prev) => ({
        ...prev,
        [protocolo]: {
          tipo: 'sucesso',
          texto: action === 'ACEITAR'
            ? 'Proposta aceita. O AT foi avisado.'
            : action === 'RECUSAR'
              ? 'Proposta recusada. O AT foi avisado.'
              : 'Contraproposta enviada. Aguarde a análise do AT.'
        }
      }));
    } catch {
      setAvisoNegociacao((prev) => ({ ...prev, [protocolo]: { tipo: 'erro', texto: 'Não foi possível enviar sua resposta. Tente novamente.' } }));
    } finally {
      respostasEmAndamentoRef.current -= 1;
      setRespondendo((prev) => ({ ...prev, [protocolo]: false }));
    }
  };

  return (
    <div id="viewAcompanhamento" className="view-section me-page">
      <style>{estiloMeusEnvios}</style>

      <div className="me-topo">
        <div>
          <h2 className="page-title me-titulo">Meus Envios</h2>
          <p className="me-subtitulo">Acompanhe seus lotes, responda negociações e finalize o que estiver pronto.</p>
        </div>
        <button className="me-btn" type="button" onClick={() => void carregar()} disabled={isLoading}>
          <i className={`material-icons${isLoading ? ' me-girando' : ''}`}>refresh</i>
          {isLoading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      <div className="me-busca">
        <i className="material-icons" aria-hidden="true">search</i>
        <input
          type="text"
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por protocolo"
          aria-label="Buscar por protocolo"
        />
        {filtroTexto && (
          <button type="button" className="me-busca-limpar" aria-label="Limpar busca" onClick={() => setFiltroTexto('')}>
            <i className="material-icons">close</i>
          </button>
        )}
      </div>

      <div className="envios-abas" role="tablist" aria-label="Situação dos envios">
        {([
          ['andamento', 'pending_actions', 'Em andamento'],
          ['finalizados', 'task_alt', 'Finalizados']
        ] as const).map(([chave, icone, titulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            aria-selected={aba === chave}
            className={`envios-aba${aba === chave ? ' ativa' : ''}`}
            onClick={() => setAba(chave)}
          >
            <i className="material-icons" aria-hidden="true">{icone}</i>
            {titulo}
            <span className="envios-aba-contador">{gruposPorAba[chave].length}</span>
          </button>
        ))}
      </div>

      <div id="listaAcompanhamentoPA">
        {isLoading && filtrados.length === 0 && (
          <div className="me-estado" role="status">
            <span className="me-spinner" aria-hidden="true" /> Carregando seus envios...
          </div>
        )}
        {loadError && (
          <div className="me-erro" role="alert">
            <i className="material-icons" aria-hidden="true">error_outline</i>
            <span>{loadError}</span>
            <button type="button" className="me-btn" onClick={() => void carregar()}>Tentar novamente</button>
          </div>
        )}
        {!isLoading && !loadError && filtrados.length === 0 && (
          <div className="me-estado me-vazio">
            <i className="material-icons" aria-hidden="true">{filtroTexto.trim() ? 'search_off' : 'inbox'}</i>
            <p>
              {filtroTexto.trim()
                ? `Nenhum protocolo com "${filtroTexto.trim()}" ${aba === 'finalizados' ? 'nos finalizados' : 'em andamento'}.`
                : aba === 'finalizados' ? 'Nenhum protocolo finalizado.' : 'Nenhum protocolo em andamento.'}
            </p>
            {filtroTexto.trim() && gruposPorAba[outraAba].length > 0 ? (
              <button className="me-btn envios-ver-outra-aba" type="button" onClick={() => setAba(outraAba)}>
                {gruposPorAba[outraAba].length} encontrado(s) em {outraAba === 'finalizados' ? 'Finalizados' : 'Em andamento'}: ver
              </button>
            ) : !filtroTexto.trim() && aba === 'andamento' ? (
              <button className="me-btn" type="button" onClick={() => navigate('/importar-orcamento')}>
                <i className="material-icons">upload_file</i> Importar orçamento
              </button>
            ) : null}
          </div>
        )}

        {filtrados.map(([protocolo, itens]) => {
          const totalItensNoLote = totalItensByProtocolo[protocolo] || itens.length;
          const loteCompleto = itens.length >= totalItensNoLote;
          const itensPendentes = itens.filter((item) => ![4, 10].includes(Number(item.status)));
          const maxStatus = Math.max(...(itensPendentes.length ? itensPendentes : itens).map((i) => Number(i.status || 0)));
          const podeFinalizar = loteCompleto
            && itens.length > 0
            && itens.every((item) => isItemEmMontagem(item) && item.orcamentoPronto !== false && item.envioFinalizado !== true);
          // Lote ainda em montagem sem o botao: diz o que falta em vez de so esconder o "Finalizar lote".
          const itensSemOrcamento = Math.max(0, totalItensNoLote - itens.length)
            + itens.filter((item) => isItemEmMontagem(item) && item.orcamentoPronto === false).length;
          const bloqueioFinalizar = !podeFinalizar && itensSemOrcamento > 0
            && itens.every((item) => isItemEmMontagem(item) && item.envioFinalizado !== true)
            ? `Para finalizar: ${itensSemOrcamento} item(ns) sem orçamento lançado (avaria aguardando foto ou envio interrompido). Termine em Lançar Orçamentos.`
            : '';
          const idsLote = idsLotePorProtocolo[normalizeProtocolKey(protocolo)] || itens
            .map((item) => item.dbId == null ? '' : String(item.dbId))
            .filter((id) => /^\d+$/.test(id));
          const cnpjLote = String(itens[0]?.cnpj || cnpjPosto || '').replace(/\D/g, '');
          const possuiNegociacaoPendente = itens.some((item) => hasNegociacaoPendente(item));
          const statusAtual = possuiNegociacaoPendente ? 7 : !loteCompleto ? 8 : maxStatus;
          const dataEnvio = itens[0]?.criadoEm || '';
          const quantidadeItens = itens.length;
          const negociacao = negociacoesByProtocolo[protocolo];
          const valorPedido = valorPositivo(negociacao?.valor_original);
          const propostaAt = valorPositivo(negociacao?.valor_proposto_at);
          const contraproposta = valorPositivo(negociacao?.valor_contraproposta_posto);
          const diferencaProposta = propostaAt != null && valorPedido != null ? propostaAt - valorPedido : null;
          const aguardandoPosto = String(negociacao?.acao_pendente_de || '').toUpperCase() === 'POSTO';
          const aviso = avisoNegociacao[protocolo];
          const mostrarAvisoSemVinculo = possuiNegociacaoPendente && !negociacao;
          const totalLote = itens.reduce((total, item) => total + Number(item.totalOrcamento || 0), 0);
          const temNegociacaoAplicada = itens.some((item) => item.negociacaoAplicada);
          const temRetificacao = itens.some((item) => item.retificacao);
          const resultados = [
            ['Aprovado', 'aprovado(s)'],
            ['Reprovado', 'reprovado(s)'],
            ['Retificado', 'retificado(s)'],
            ['Aguardando análise', 'aguardando análise']
          ].map(([chave, rotulo]) => ({ chave, rotulo, qtd: itens.filter((item) => resultadoItem(item) === chave).length }));
          const aberto = Boolean(abertos[protocolo]);
          const alternar = () => setAbertos((prev) => ({ ...prev, [protocolo]: !prev[protocolo] }));
          return (
            <div key={protocolo} className={`protocolo-card me-lote${aberto ? ' open' : ''}${podeFinalizar ? ' pronto-finalizar' : ''}${aguardandoPosto ? ' me-lote-acao' : ''}`}>
              <div
                className="protocolo-header me-lote-cab"
                role="button"
                tabIndex={0}
                aria-expanded={aberto}
                onClick={alternar}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); alternar(); }
                }}
              >
                <div className="me-lote-id">
                  <span className="me-lote-protocolo">{protocolo}</span>
                  <span className="me-lote-meta">
                    {dataEnvio ? formatDateTime(dataEnvio) : 'Sem data'}
                    <span className="me-sep">·</span>
                    {quantidadeItens}/{totalItensNoLote} {totalItensNoLote === 1 ? 'item' : 'itens'}
                    <span className="me-sep">·</span>
                    <strong>{formatCurrency(totalLote)}</strong>
                  </span>
                  {(podeFinalizar || aguardandoPosto) && (
                    <span className={`me-lote-chamada${aguardandoPosto ? ' negociacao' : ''}`}>
                      {aguardandoPosto ? 'O AT enviou uma proposta: responda' : 'Pronto para finalizar'}
                    </span>
                  )}
                  {bloqueioFinalizar && !aguardandoPosto && (
                    <span className="me-lote-chamada negociacao">
                      {bloqueioFinalizar}{' '}
                      <button type="button" className="me-link-lancar" onClick={(e) => { e.stopPropagation(); navigate('/lancar-orcamentos'); }}>
                        Abrir Lançar Orçamentos
                      </button>
                    </span>
                  )}
                </div>
                <div className="header-meta me-lote-dir">
                  <span className="me-status">
                    <span className="me-status-ponto" style={{ background: statusCor(statusAtual) }} />
                    {getStatusLabel(statusAtual)}
                  </span>
                  {podeFinalizar && <AcaoLotePosto acao="CONCLUIR" protocolo={protocolo} cnpj={cnpjLote} ids={idsLote} onSaved={() => void carregar(true)} />}
                  <i className="material-icons arrow-icon">keyboard_arrow_down</i>
                </div>
              </div>
              <div className="protocolo-detalhes me-lote-corpo">
                <dl className="me-resumo">
                  <div>
                    <dt>{temRetificacao ? 'Total após retificações' : temNegociacaoAplicada ? 'Total atualizado dos itens' : 'Total informado pelo posto'}</dt>
                    <dd>{formatCurrency(totalLote)}</dd>
                  </div>
                  {temNegociacaoAplicada && (
                    <div>
                      <dt>Valor oficial aprovado</dt>
                      <dd>{formatCurrency(itens.reduce((total, item) => total + (valorFinalItem(item, negociacao) ?? 0), 0))}</dd>
                    </div>
                  )}
                  {negociacao && valorAceito(negociacao) != null && (
                    <div>
                      <dt>Valor acordado ({negociacao.negotiation_scope === 'LOTE' ? 'lote' : 'itens da negociação'})</dt>
                      <dd>{formatCurrency(valorAceito(negociacao))}</dd>
                    </div>
                  )}
                  <div className="me-resumo-resultado">
                    <dt>Resultado</dt>
                    <dd>
                      {resultados.filter((r) => r.qtd > 0).map((r) => `${r.qtd} ${r.rotulo}`).join(' · ') || '—'}
                    </dd>
                  </div>
                </dl>
                {negociacao && valorAceito(negociacao) != null && temRetificacao && (
                  <p className="me-nota">Negociação anterior à retificação, preservada para consulta. Confira os itens retificados abaixo.</p>
                )}
                {mostrarAvisoSemVinculo && (
                  <div className="me-alerta-amarelo">
                    <strong>Negociação pendente de sincronização</strong>
                    <span>
                      Este lote tem item em negociação no Ravena, mas o registro da negociação ainda não apareceu no painel.
                      Atualize a página em alguns instantes. Se continuar assim, vale conferir a gravação do protocolo no Supabase.
                    </span>
                  </div>
                )}
                {negociacao && (
                  <section className={`negociacao-card${aguardandoPosto ? ' aguardando-posto' : ''}`} aria-label="Negociação">
                    <header className="negociacao-topo">
                      <div>
                        <h4>Negociação</h4>
                        <small>Atualizado em {formatDateTime(negociacao.updated_at)}</small>
                      </div>
                      <span className="negociacao-status">{getNegociacaoStatusLabel(negociacao.status)}</span>
                    </header>

                    {aguardandoPosto && (
                      <p className="negociacao-chamada">
                        O AT enviou uma proposta para este orçamento. Aceite, recuse ou faça uma contraproposta.
                      </p>
                    )}

                    <div className="negociacao-valores">
                      <div className="negociacao-valor-card">
                        <label>Valor pedido</label>
                        <strong>{formatCurrency(valorPedido)}</strong>
                      </div>
                      <div className={`negociacao-valor-card${contraproposta == null ? ' negociacao-valor-atual' : ''}`}>
                        <label>Proposta do AT</label>
                        <strong>{propostaAt != null ? formatCurrency(propostaAt) : '-'}</strong>
                        {diferencaProposta != null && diferencaProposta !== 0 && (
                          <small className="negociacao-diferenca">
                            {formatCurrency(Math.abs(diferencaProposta))} {diferencaProposta < 0 ? 'a menos' : 'a mais'} que o pedido
                          </small>
                        )}
                      </div>
                      {contraproposta != null && (
                        <div className="negociacao-valor-card negociacao-valor-atual">
                          <label>Sua contraproposta</label>
                          <strong>{formatCurrency(contraproposta)}</strong>
                        </div>
                      )}
                    </div>

                    {negociacao.observacao_at && (
                      <blockquote className="negociacao-observacao">
                        <span>Observação do AT</span>
                        {negociacao.observacao_at}
                      </blockquote>
                    )}
                    {!aguardandoPosto && negociacao.observacao_posto && (
                      <blockquote className="negociacao-observacao">
                        <span>Sua observação</span>
                        {negociacao.observacao_posto}
                      </blockquote>
                    )}

                    {aviso && (
                      <p className={`negociacao-aviso ${aviso.tipo}`} role={aviso.tipo === 'erro' ? 'alert' : 'status'}>{aviso.texto}</p>
                    )}

                    {aguardandoPosto ? (
                      contraAberta[protocolo] ? (
                        <form
                          className="negociacao-contraproposta"
                          onSubmit={(e) => { e.preventDefault(); void responderNegociacao(protocolo, 'CONTRAPROPOSTA'); }}
                        >
                          <div className="lancamento-row lancamento-row-2">
                            <div className="lancamento-field">
                              <label htmlFor={`contra-valor-${protocolo}`}>Valor da contraproposta</label>
                              <div className="negociacao-currency-input">
                                <span>R$</span>
                                <input
                                  id={`contra-valor-${protocolo}`}
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0,00"
                                  autoFocus
                                  value={contraValores[protocolo] || ''}
                                  onChange={(e) => setContraValores((prev) => ({ ...prev, [protocolo]: e.target.value.replace(/[^\d,.-]/g, '') }))}
                                  onBlur={() => setContraValores((prev) => ({
                                    ...prev,
                                    [protocolo]: formatCurrencyInput(parseCurrencyInput(prev[protocolo] || ''))
                                  }))}
                                />
                              </div>
                              {valorPedido != null && (
                                <div className="negociacao-atalhos">
                                  <button
                                    type="button"
                                    onClick={() => setContraValores((prev) => ({ ...prev, [protocolo]: formatCurrencyInput(valorPedido) }))}
                                  >
                                    Usar valor pedido ({formatCurrency(valorPedido)})
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="lancamento-field">
                              <label htmlFor={`contra-obs-${protocolo}`}>Observação (opcional)</label>
                              <input
                                id={`contra-obs-${protocolo}`}
                                type="text"
                                placeholder="Explique o motivo do valor"
                                value={contraObs[protocolo] || ''}
                                onChange={(e) => setContraObs((prev) => ({ ...prev, [protocolo]: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="negociacao-acoes">
                            <button
                              className="btn btn-primary btn-sm"
                              type="submit"
                              disabled={Boolean(respondendo[protocolo]) || parseCurrencyInput(contraValores[protocolo] || '') <= 0}
                            >
                              {respondendo[protocolo] ? 'Enviando…' : 'Enviar contraproposta'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              type="button"
                              disabled={Boolean(respondendo[protocolo])}
                              onClick={() => setContraAberta((prev) => ({ ...prev, [protocolo]: false }))}
                            >
                              Voltar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="negociacao-acoes">
                          <button
                            className="btn btn-success btn-sm"
                            type="button"
                            disabled={Boolean(respondendo[protocolo]) || propostaAt == null}
                            onClick={() => responderNegociacao(protocolo, 'ACEITAR')}
                          >
                            {respondendo[protocolo] ? 'Enviando…' : `Aceitar ${propostaAt != null ? formatCurrency(propostaAt) : 'proposta'}`}
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            disabled={Boolean(respondendo[protocolo])}
                            onClick={() => {
                              setAvisoNegociacao((prev) => ({ ...prev, [protocolo]: undefined }));
                              setContraAberta((prev) => ({ ...prev, [protocolo]: true }));
                            }}
                          >
                            Fazer contraproposta
                          </button>
                          <button
                            className="negociacao-recusar"
                            type="button"
                            disabled={Boolean(respondendo[protocolo])}
                            onClick={() => responderNegociacao(protocolo, 'RECUSAR')}
                          >
                            Recusar proposta
                          </button>
                        </div>
                      )
                    ) : (
                      <p className="negociacao-espera">
                        <i className="material-icons" aria-hidden="true">
                          {String(negociacao.acao_pendente_de || '').toUpperCase() === 'AT' ? 'hourglass_top' : 'info'}
                        </i>
                        {String(negociacao.acao_pendente_de || '').toUpperCase() === 'AT'
                          ? 'Sua resposta foi enviada. Aguardando a análise do AT.'
                          : 'Negociação acompanhada pelo sistema.'}
                      </p>
                    )}
                  </section>
                )}
                <div className="table-scroll me-tabela-wrap">
                  <table className="tabela-horizontal me-tabela">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Serial</th>
                        <th>Cód. barras</th>
                        <th>Fornecedor</th>
                        <th>Linha</th>
                        <th>Classificação</th>
                        <th className="me-num">Peças</th>
                        <th className="me-num">Acess.</th>
                        <th className="me-num">Mão de obra</th>
                        <th className="me-num">Embal.</th>
                        <th className="me-num">Hig.</th>
                        <th className="me-num">Total informado</th>
                        <th className="me-num">Valor final aprovado</th>
                        <th>Resultado</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item) => {
                        const valorFinal = valorFinalItem(item, negociacao);
                        const moeda = (v?: number) => (v != null ? formatCurrency(v) : '-');
                        const resultado = resultadoItem(item);
                        return (
                        <tr key={item.id}>
                          <td className="me-produto">
                            <strong>{item.codGemco || '-'}</strong>
                            <span title={item.descricao}>{item.descricao || '-'}</span>
                          </td>
                          <td className="me-mono">{item.serial || '-'}</td>
                          <td className="me-mono">{item.codBarras || '-'}</td>
                          <td>{item.fornecedor || '-'}</td>
                          <td>{item.linha || '-'}</td>
                          <td>{item.tipoOrc || '-'}</td>
                          <td className="me-num">{moeda(item.valPecas)}</td>
                          <td className="me-num">{moeda(item.valAcess)}</td>
                          <td className="me-num">{moeda(item.valMaoObra)}</td>
                          <td className="me-num">{moeda(item.valEmb)}</td>
                          <td className="me-num">{moeda(item.valHig)}</td>
                          <td className="me-num">{moeda(item.totalOrcamento)}</td>
                          <td className="me-num"><strong>{valorFinal != null ? formatCurrency(valorFinal) : '-'}</strong></td>
                          <td>
                            <span className={`me-resultado me-resultado-${String(resultado).normalize('NFD').replace(/[^\w]/g, '').toLowerCase()}`}>{resultado}</span>
                            {item.retificacao && (
                              <div className="me-retificacao">
                                <span>{item.retificacao.motivo === 'DEVOLUCAO' ? 'Devolução' : 'Desconsiderar reparo'}</span>
                                <span>Valor anterior: {formatCurrency(item.retificacao.original?.total_orcamento ?? 0)} · Valor atual: {formatCurrency(0)}</span>
                                <span>{item.retificacao.responsavel} · {new Date(item.retificacao.data).toLocaleString('pt-BR')}</span>
                              </div>
                            )}
                          </td>
                          <td className="me-status-item">{item.statusText === 'CANCELADO_POSTO' ? 'Cancelado pelo posto — editar para relançar' : getStatusLabel(item.status)}</td>
                          <td>
                            {isItemEmMontagem(item) && item.envioFinalizado !== true && (
                              <button
                                className="me-btn me-btn-sm"
                                type="button"
                                onClick={() => navigate('/lancar-orcamentos', { state: { item } })}
                              >
                                <i className="material-icons">edit</i>
                                Editar valores
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })}
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
