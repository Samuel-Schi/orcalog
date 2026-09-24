import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStatusLabel } from '../lib/statusMap';
import { resultadoItem, valorFinalItem, valorAceito } from '../lib/resultadoOrcamento';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

type ItemEnvio = {
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
  id: String(row.id ?? row.ID ?? `${row.protocolo ?? row.PROTOCOLO ?? 'p'}-${index}`),
  dbId: (() => {
    const rawId = row.id ?? row.ID ?? row.dbId;
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
  const [filtroTexto, setFiltroTexto] = useState('');
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [items, setItems] = useState<ItemEnvio[]>([]);
  const [totalItensByProtocolo, setTotalItensByProtocolo] = useState<Record<string, number>>({});
  const [negociacoesByProtocolo, setNegociacoesByProtocolo] = useState<Record<string, NegociacaoSupabaseRow>>({});
  const [contraValores, setContraValores] = useState<Record<string, string>>({});
  const [contraObs, setContraObs] = useState<Record<string, string>>({});
  const [respondendo, setRespondendo] = useState<Record<string, boolean>>({});
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
      const [res, statusRes, negociacoesRes] = await Promise.all([
        oracleApi.get(ORACLE_ENDPOINTS.getEnvios, {
          signal: controller.signal,
          params: { cnpj, _ts: Date.now() },
          responseType: 'arraybuffer',
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          validateStatus: (status) => status >= 200 && status < 400
        }),
        oracleApi.get(ORACLE_ENDPOINTS.getEnviosStatusSupabase, {
          signal: controller.signal,
          params: { cnpj, _ts: Date.now() },
          validateStatus: (status) => status >= 200 && status < 500
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

      const supaRaw = statusRes.data;
      if (statusRes.status >= 400 || (!Array.isArray(supaRaw) && !Array.isArray(supaRaw?.items))) {
        throw new Error('Falha ao consultar os resultados dos orcamentos.');
      }
      const supaList: StatusSupabaseRow[] = Array.isArray(supaRaw)
        ? supaRaw
        : Array.isArray(supaRaw?.items)
          ? supaRaw.items
          : [];

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
          status: Number(atual?.status ?? item.status ?? 0),
          statusText: atual?.status_text,
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
    const atualizarSeVisivel = () => {
      if (document.visibilityState === 'visible') void carregar(true);
    };
    void carregar();
    const interval = window.setInterval(atualizarSeVisivel, 30000);
    document.addEventListener('visibilitychange', atualizarSeVisivel);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', atualizarSeVisivel);
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

  const filtrados = useMemo(() => {
    const termo = filtroTexto.trim().toLowerCase();
    return grupos.filter(([protocolo]) => !termo || protocolo.toLowerCase().includes(termo));
  }, [filtroTexto, grupos]);

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

  const getNegotiatedValue = (negociacao: NegociacaoSupabaseRow) => {
    const contraproposta = Number(negociacao.valor_contraproposta_posto);
    if (Number.isFinite(contraproposta) && contraproposta > 0) return contraproposta;

    const propostaAt = Number(negociacao.valor_proposto_at);
    return Number.isFinite(propostaAt) && propostaAt > 0 ? propostaAt : null;
  };

  const getNegotiatedValueLabel = (negociacao: NegociacaoSupabaseRow) => {
    const contraproposta = Number(negociacao.valor_contraproposta_posto);
    return Number.isFinite(contraproposta) && contraproposta > 0
      ? 'Sua contraproposta'
      : 'Proposta em negociação';
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
    if (normalized === 'ABERTA_AT') return 'Proposta recebida do AT';
    if (normalized === 'ACEITA_POSTO') return 'Proposta aceita pelo posto';
    if (normalized === 'RECUSADA_POSTO') return 'Proposta recusada pelo posto';
    if (normalized === 'CONTRAPROPOSTA_POSTO') return 'Contraproposta enviada ao AT';
    return normalized || 'Negociacao em andamento';
  };

  const responderNegociacao = async (
    protocolo: string,
    action: 'ACEITAR' | 'RECUSAR' | 'CONTRAPROPOSTA'
  ) => {
    const negociacao = negociacoesByProtocolo[protocolo];
    if (!negociacao) return;

    const valorContraproposta = parseCurrencyInput(contraValores[protocolo] || '');
    if (action === 'CONTRAPROPOSTA' && (!Number.isFinite(valorContraproposta) || valorContraproposta <= 0)) {
      return;
    }

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
    } finally {
      respostasEmAndamentoRef.current -= 1;
      setRespondendo((prev) => ({ ...prev, [protocolo]: false }));
    }
  };

  return (
    <div id="viewAcompanhamento" className="view-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <h2 className="page-title" style={{ marginBottom: 0, paddingBottom: 5, fontSize: '1.1rem', borderBottom: 'none' }}>
          Meus Envios
        </h2>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void carregar()} disabled={isLoading}>
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
          placeholder="Buscar por protocolo..."
          className="search-input"
        />
      </div>

      <div id="listaAcompanhamentoPA">
        {isLoading && (
          <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Carregando...</p>
        )}
        {loadError && <p role="alert">{loadError} <button type="button" onClick={() => void carregar()}>Tentar novamente</button></p>}
        {!isLoading && !loadError && filtrados.length === 0 && (
          <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Nenhum registro encontrado.</p>
        )}

        {filtrados.map(([protocolo, itens]) => {
          const totalItensNoLote = totalItensByProtocolo[protocolo] || itens.length;
          const loteCompleto = itens.length >= totalItensNoLote;
          const itensPendentes = itens.filter((item) => ![4, 10].includes(Number(item.status)));
          const maxStatus = Math.max(...(itensPendentes.length ? itensPendentes : itens).map((i) => Number(i.status || 0)));
          const possuiNegociacaoPendente = itens.some((item) => hasNegociacaoPendente(item));
          const statusAtual = possuiNegociacaoPendente ? 7 : !loteCompleto ? 8 : maxStatus;
          const dataEnvio = itens[0]?.criadoEm || '';
          const quantidadeItens = itens.length;
          const negociacao = negociacoesByProtocolo[protocolo];
          const valorPedido = Number(negociacao?.valor_original);
          const valorEmNegociacao = negociacao ? getNegotiatedValue(negociacao) : null;
          const diferencaNegociacao = valorEmNegociacao != null && Number.isFinite(valorPedido)
            ? valorEmNegociacao - valorPedido
            : null;
          const mostrarAvisoSemVinculo = possuiNegociacaoPendente && !negociacao;
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
                <div className="header-meta">
                  <span className="item-count-badge">
                    {quantidadeItens}/{totalItensNoLote} {totalItensNoLote === 1 ? 'item' : 'itens'}
                  </span>
                  <span className="status-badge" style={{ background: statusCor(statusAtual) }}>
                    {getStatusLabel(statusAtual)}
                  </span>
                  <i className="material-icons arrow-icon">keyboard_arrow_down</i>
                </div>
              </div>
              <div className="protocolo-detalhes">
                <div style={{ marginBottom: 16 }}>
                  <strong>Total informado pelo posto: </strong>
                  {formatCurrency(itens.reduce((total, item) => total + Number(item.totalOrcamento || 0), 0))}
                  {' | '}<strong>Resultado: </strong>
                  {itens.filter((item) => resultadoItem(item) === 'Aprovado').length} aprovado(s),{' '}
                  {itens.filter((item) => resultadoItem(item) === 'Reprovado').length} reprovado(s),{' '}
                  {itens.filter((item) => resultadoItem(item) === 'Aguardando análise').length} aguardando análise
                  {negociacao && valorAceito(negociacao) != null && (
                    <div>
                      <strong>Valor acordado ({negociacao.negotiation_scope === 'LOTE' ? 'lote' : 'itens da negociação'}): </strong>
                      {formatCurrency(valorAceito(negociacao))}
                    </div>
                  )}
                </div>
                {mostrarAvisoSemVinculo && (
                  <div
                    className="card"
                    style={{
                      marginBottom: 12,
                      borderTopColor: '#f59e0b',
                      background: '#fff7ed'
                    }}
                  >
                    <div className="section-title">Negociacao pendente de sincronizacao</div>
                    <div style={{ color: '#9a3412' }}>
                      Este lote tem item em negociacao no Ravena, mas o registro da negociacao ainda nao apareceu no painel.
                      Atualize a pagina em alguns instantes. Se continuar assim, vale conferir a gravacao do protocolo no Supabase.
                    </div>
                  </div>
                )}
                {negociacao && (
                  <div className="card" style={{ marginBottom: 12, borderTopColor: '#f59e0b' }}>
                    <div className="section-title">Negociacao</div>
                    <div className="lancamento-row lancamento-row-2" style={{ marginBottom: 10 }}>
                      <div className="lancamento-field">
                        <label>Status da negociacao</label>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{getNegociacaoStatusLabel(negociacao.status)}</div>
                      </div>
                      <div className="lancamento-field">
                        <label>Atualizado em</label>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{formatDateTime(negociacao.updated_at)}</div>
                      </div>
                    </div>
                    <div className="negociacao-valores">
                      <div className="negociacao-valor-card">
                        <label>Valor pedido</label>
                        <strong>{formatCurrency(negociacao.valor_original)}</strong>
                      </div>
                      <div className="negociacao-valor-card negociacao-valor-atual">
                        <label>{getNegotiatedValueLabel(negociacao)}</label>
                        <strong>{valorEmNegociacao != null ? formatCurrency(valorEmNegociacao) : '-'}</strong>
                        {diferencaNegociacao != null && (
                          <small className={diferencaNegociacao <= 0 ? 'negociacao-economia' : 'negociacao-acrescimo'}>
                            {diferencaNegociacao === 0
                              ? 'Mesmo valor do pedido'
                              : `${formatCurrency(Math.abs(diferencaNegociacao))} ${diferencaNegociacao < 0 ? 'abaixo' : 'acima'} do pedido`}
                          </small>
                        )}
                      </div>
                    </div>
                    {Number(negociacao.valor_contraproposta_posto) > 0 && (
                      <div className="lancamento-row lancamento-row-1" style={{ marginBottom: 10 }}>
                        <div className="lancamento-field">
                          <label>Proposta do AT</label>
                          <div style={{ color: '#475569' }}>{formatCurrency(negociacao.valor_proposto_at)}</div>
                        </div>
                      </div>
                    )}
                    <div className="lancamento-row lancamento-row-1" style={{ marginBottom: 10 }}>
                      <div className="lancamento-field">
                        <label>Observacao do AT</label>
                        <div style={{ color: '#475569' }}>{negociacao.observacao_at || '-'}</div>
                      </div>
                    </div>
                    {String(negociacao.acao_pendente_de || '').toUpperCase() === 'POSTO' ? (
                      <>
                        <div className="lancamento-row lancamento-row-2">
                          <div className="lancamento-field">
                            <label>Minha contraproposta</label>
                            <div className="negociacao-currency-input">
                              <span>R$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={contraValores[protocolo] || ''}
                                onChange={(e) => setContraValores((prev) => ({ ...prev, [protocolo]: e.target.value.replace(/[^\d,.-]/g, '') }))}
                                onBlur={() => setContraValores((prev) => ({
                                  ...prev,
                                  [protocolo]: formatCurrencyInput(parseCurrencyInput(prev[protocolo] || ''))
                                }))}
                              />
                            </div>
                            <div className="negociacao-atalhos">
                              <button
                                type="button"
                                onClick={() => setContraValores((prev) => ({ ...prev, [protocolo]: formatCurrencyInput(negociacao.valor_proposto_at) }))}
                              >
                                Usar proposta do AT
                              </button>
                              <button
                                type="button"
                                onClick={() => setContraValores((prev) => ({ ...prev, [protocolo]: formatCurrencyInput(negociacao.valor_original) }))}
                              >
                                Usar valor pedido
                              </button>
                            </div>
                          </div>
                          <div className="lancamento-field">
                            <label>Observacao do posto</label>
                            <input
                              type="text"
                              placeholder="Opcional"
                              value={contraObs[protocolo] || ''}
                              onChange={(e) => setContraObs((prev) => ({ ...prev, [protocolo]: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="action-bar" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
                          <button
                            className="btn btn-success btn-sm"
                            type="button"
                            disabled={Boolean(respondendo[protocolo])}
                            onClick={() => responderNegociacao(protocolo, 'ACEITAR')}
                          >
                            Aceitar proposta
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            disabled={Boolean(respondendo[protocolo])}
                            onClick={() => responderNegociacao(protocolo, 'CONTRAPROPOSTA')}
                          >
                            Enviar contraproposta
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            disabled={Boolean(respondendo[protocolo])}
                            onClick={() => responderNegociacao(protocolo, 'RECUSAR')}
                          >
                            Recusar proposta
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b' }}>
                        {String(negociacao.acao_pendente_de || '').toUpperCase() === 'AT'
                          ? 'Sua resposta ja foi enviada. Agora o AT precisa analisar.'
                          : 'Negociacao acompanhada pelo sistema.'}
                      </div>
                    )}
                  </div>
                )}
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
                        <th>Pecas</th>
                        <th>Acess.</th>
                        <th>Mao de Obra</th>
                        <th>Embal.</th>
                        <th>Hig.</th>
                        <th>Total informado pelo posto</th>
                        <th>Valor final aprovado</th>
                        <th>Resultado</th>
                        <th>Status</th>
                        <th>Acoes</th>
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
                          <td>{item.totalOrcamento != null ? formatCurrency(item.totalOrcamento) : '-'}</td>
                          <td>{valorFinalItem(item, negociacao) != null ? formatCurrency(valorFinalItem(item, negociacao)) : '-'}</td>
                          <td>{resultadoItem(item)}</td>
                          <td>{getStatusLabel(item.status)}</td>
                          <td>
                            {[0, 1].includes(Number(item.status || 0)) && (
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                onClick={() => navigate('/lancar-orcamentos', { state: { item } })}
                              >
                                <i className="material-icons" style={{ fontSize: 14, marginRight: 4 }}>edit</i>
                                Editar
                              </button>
                            )}
                          </td>
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
