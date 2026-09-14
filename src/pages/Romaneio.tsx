import { useEffect, useMemo, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { buildRomaneioPrintDocument } from '../lib/romaneioPrintTemplate';

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

const splitDescricao = (value?: string, prefix?: string) =>
  String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index) => !(prefix && index === 0 && part.toLowerCase() === prefix.toLowerCase()));

const formatLista = (value?: string, prefix?: string) => {
  const items = splitDescricao(value, prefix);
  return items.length > 0 ? items.join(', ') : '-';
};

const formatComposicao = (item: RomaneioItem) => {
  const partes: string[] = [];
  const pecas = formatLista(item.pecasDesc, 'pe');
  const acessorios = formatLista(item.acessDesc, 'ac');

  if (pecas !== '-') partes.push(`Pecas: ${pecas}`);
  if (acessorios !== '-') partes.push(`Acessorios: ${acessorios}`);
  if (Number(item.valMaoObra || 0) > 0) partes.push(`Mao de obra: ${formatMoney(item.valMaoObra)}`);
  if (Number(item.valEmb || 0) > 0) partes.push(`Embalagem: ${formatMoney(item.valEmb)}`);
  if (Number(item.valHig || 0) > 0) partes.push(`Higienizacao: ${formatMoney(item.valHig)}`);

  return partes.length > 0 ? partes.join(' | ') : '-';
};

const Romaneio = () => {
  const [items, setItems] = useState<RomaneioItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [protocoloExpandido, setProtocoloExpandido] = useState<string | null>(null);

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

  const imprimir = (protocolo: string, itens: RomaneioItem[], criadoEm?: string) => {
    const documento = buildRomaneioPrintDocument({
      protocolo,
      criadoEm: formatDateTime(criadoEm),
      totalLote: itens.reduce((acc, item) => acc + Number(item.totalOrcamento || 0), 0),
      items: itens
    });
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const frameWindow = iframe.contentWindow;
    const frameDocument = iframe.contentDocument || frameWindow?.document;

    if (!frameWindow || !frameDocument) {
      document.body.removeChild(iframe);
      return;
    }

    frameDocument.open();
    frameDocument.write(documento);
    frameDocument.close();

    frameWindow.onload = () => {
      frameWindow.focus();
      frameWindow.print();
    };

    const cleanup = () => {
      window.setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 300);
    };

    frameWindow.onafterprint = cleanup;
    window.setTimeout(cleanup, 60000);
  };

  return (
    <div className="view-section romaneio-page">
      <div className="romaneio-page-top no-print">
        <h2 className="page-title romaneio-page-title">Romaneio</h2>
        <button className="btn btn-secondary btn-sm" type="button" onClick={carregar}>
          <i className="material-icons" style={{ fontSize: 14, marginRight: 4 }}>refresh</i>
          Atualizar
        </button>
      </div>

      <div className="filter-bar no-print">
        <i className="material-icons" style={{ color: '#888' }}>search</i>
        <input
          type="text"
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por protocolo, razao social ou GEMCO..."
          className="search-input"
        />
      </div>

      {isLoading && (
        <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Carregando...</p>
      )}

      {!isLoading && filtrados.length === 0 && (
        <p style={{ textAlign: 'center', color: '#999', marginTop: 20 }}>Nenhum romaneio disponivel.</p>
      )}

      <div className="romaneio-list">
        {filtrados.map(([protocolo, itens]) => {
          const first = itens[0];
          const totalProtocolo = itens.reduce((acc, item) => acc + Number(item.totalOrcamento || 0), 0);
          const expanded = protocoloExpandido === protocolo;

          return (
            <section key={protocolo} className={`romaneio-sheet-shell${expanded ? ' expanded' : ''}`}>
              <button
                type="button"
                className="romaneio-toggle no-print"
                onClick={() => setProtocoloExpandido((current) => (current === protocolo ? null : protocolo))}
              >
                <div className="romaneio-toggle-main">
                  <strong>Protocolo {protocolo}</strong>
                  <span>{first?.razaoSocial || 'Magazine Luiza S.A'}</span>
                </div>
                <div className="romaneio-toggle-side">
                  <span className="romaneio-toggle-count">{itens.length === 1 ? '1 item' : `${itens.length} itens`}</span>
                  <strong>{formatMoney(totalProtocolo)}</strong>
                  <i className="material-icons">{expanded ? 'expand_less' : 'expand_more'}</i>
                </div>
              </button>

              {expanded && (
                <>
                  <div className="romaneio-actions no-print">
                    <div className="romaneio-actions-text">
                      <strong>Documento pronto para impressao</strong>
                      <span>Confira os dados antes de imprimir</span>
                    </div>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => imprimir(protocolo, itens, first?.criadoEm)}>
                      <i className="material-icons">print</i>
                      Imprimir
                    </button>
                  </div>

                  <article className="romaneio-sheet-document">
                    <header className="romaneio-doc-top">
                      <div className="romaneio-doc-title-block">
                        <div className="romaneio-doc-title">ROMANEIO</div>
                        <div className="romaneio-doc-subtitle">Controle de itens em devolucao do lote</div>
                      </div>
                      <div className="romaneio-doc-number">
                        <span>No</span>
                        <strong>{protocolo}</strong>
                      </div>
                    </header>

                    <section className="romaneio-destinatario">
                      <div className="romaneio-quadro">
                        <div className="romaneio-quadro-titulo">Destinatario</div>
                        <div className="romaneio-quadro-grid">
                          <div><span>Razao social</span><strong>{first?.razaoSocial || 'Magazine Luiza S.A'}</strong></div>
                          <div><span>CNPJ</span><strong>{first?.cnpj || '-'}</strong></div>
                          <div><span>Unidade</span><strong>{first?.unidade || '-'}</strong></div>
                          <div><span>E-mail retorno</span><strong>{first?.emailRetorno || '-'}</strong></div>
                        </div>
                      </div>
                    </section>

                    <section className="romaneio-infos-strip">
                      <div><span>Emissao</span><strong>{formatDateTime(first?.criadoEm)}</strong></div>
                      <div><span>Itens</span><strong>{itens.length}</strong></div>
                      <div><span>Total do lote</span><strong>{formatMoney(totalProtocolo)}</strong></div>
                      <div><span>Documento</span><strong>Devolucao</strong></div>
                    </section>

                    <section className="romaneio-tabela-wrap">
                      <table className="romaneio-print-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Identificacao</th>
                            <th>Defeito / Motivo</th>
                            <th>Composicao</th>
                            <th>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itens.map((item, index) => (
                            <tr key={item.id}>
                              <td>
                                <strong>{String(index + 1).padStart(2, '0')} - {item.descricao || '-'}</strong>
                                <div>{item.fornecedor || '-'}</div>
                                <div>Linha: {item.linha || '-'}</div>
                              </td>
                              <td>
                                <div><strong>Cod. Barras:</strong> {item.codBarras || '-'}</div>
                                <div><strong>GEMCO:</strong> {item.codGemco || '-'}</div>
                                <div><strong>Serial:</strong> {item.serial || '-'}</div>
                              </td>
                              <td>{item.defeitoEncontrado || '-'}</td>
                              <td>{formatComposicao(item)}</td>
                              <td className="romaneio-col-total">{formatMoney(item.totalOrcamento)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4}>Total geral do lote</td>
                            <td className="romaneio-col-total">{formatMoney(totalProtocolo)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </section>

                    <section className="romaneio-observacoes">
                      <div className="romaneio-quadro-titulo">Observacao</div>
                      <div className="romaneio-observacoes-box" />
                    </section>

                    <footer className="romaneio-assinaturas">
                      <div className="romaneio-assinatura">
                        <span>Recebemos da empresa</span>
                      </div>
                      <div className="romaneio-assinatura">
                        <span>Data do recebimento</span>
                      </div>
                      <div className="romaneio-assinatura">
                        <span>Assinatura do recebedor</span>
                      </div>
                      <div className="romaneio-assinatura">
                        <span>No do romaneio</span>
                      </div>
                    </footer>
                  </article>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default Romaneio;
