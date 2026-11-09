import { useEffect, useMemo, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { buildRomaneioPrintDocument } from '../lib/romaneioPrintTemplate';
import { gerarQrRomaneioSvg } from '../lib/romaneioQr';
import { agruparPorClassificacao, tituloGrupo } from '../lib/romaneioClassificacao';

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
  tipoOrc?: string;
  defeitoEncontrado?: string;
  pecasDesc?: string;
  statusText?: string | null;
};

// Visual da tela (prefixo rom-), no mesmo tom sóbrio de Meus Envios. A folha/prévia segue o CSS global.
const estiloRomaneio = `
.rom-page { --rom-borda: #e5e7eb; --rom-texto: #1f2937; --rom-muted: #6b7280; --rom-fundo: #f9fafb; --rom-azul: var(--azul-escuro, #0056b3); }
.rom-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.rom-titulo { margin: 0 !important; padding: 0 !important; border: 0 !important; }
.rom-subtitulo { margin: 3px 0 0; font-size: .88rem; color: var(--rom-muted); }

.rom-btn { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid var(--rom-borda); border-radius: 6px; background: #fff; color: var(--rom-texto); font: inherit; font-size: .84rem; font-weight: 500; cursor: pointer; white-space: nowrap; }
.rom-btn:hover:not(:disabled) { border-color: #c7ccd4; background: var(--rom-fundo); }
.rom-btn:disabled { opacity: .6; cursor: default; }
.rom-btn .material-icons { font-size: 17px; }
.rom-btn-primario { background: var(--rom-azul); border-color: var(--rom-azul); color: #fff; }
.rom-btn-primario:hover:not(:disabled) { background: #004494; border-color: #004494; }
.rom-girando { animation: rom-girar .9s linear infinite; }

.rom-busca { position: relative; display: flex; align-items: center; margin-bottom: 12px; max-width: 420px; }
.rom-busca > .material-icons { position: absolute; left: 10px; font-size: 19px; color: #9ca3af; pointer-events: none; }
.rom-busca input { height: 38px; padding: 0 34px 0 36px; border-radius: 6px; border: 1px solid var(--rom-borda); font-size: .88rem; background: #fff; }
.rom-busca input:focus { border-color: var(--rom-azul); box-shadow: 0 0 0 3px rgba(0,86,179,.1); }
.rom-busca-limpar { position: absolute; right: 6px; width: 26px; height: 26px; border: 0; background: none; color: #9ca3af; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.rom-busca-limpar:hover { color: var(--rom-texto); background: var(--rom-fundo); }
.rom-busca-limpar .material-icons { font-size: 17px; }

.rom-estado { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 40px 16px; color: var(--rom-muted); font-size: .9rem; text-align: center; }
.rom-estado[role="status"] { flex-direction: row; justify-content: center; }
.rom-vazio { border: 1px dashed var(--rom-borda); border-radius: 8px; background: #fff; }
.rom-vazio > .material-icons { font-size: 34px; color: #c3c8d0; }
.rom-vazio p { margin: 0; max-width: 420px; }
.rom-erro { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; margin-bottom: 12px; border: 1px solid #f3c2c6; background: #fdf2f2; color: #8a1c24; border-radius: 6px; font-size: .86rem; }
.rom-erro > span { flex: 1; min-width: 200px; }
.rom-spinner { width: 15px; height: 15px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: rom-girar .8s linear infinite; display: inline-block; flex-shrink: 0; }
@keyframes rom-girar { to { transform: rotate(360deg); } }

.rom-lista { gap: 10px !important; }
.rom-lote { gap: 0 !important; background: #fff; border: 1px solid var(--rom-borda); border-radius: 8px; overflow: hidden; }
.rom-lote-cab { display: flex; align-items: center; gap: 12px; padding: 0 14px 0 0; }
.rom-lote-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 12px 0 12px 12px; border: 0; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.rom-lote-toggle:focus-visible { outline: 2px solid var(--rom-azul); outline-offset: -2px; }
.rom-seta { color: #9ca3af; font-size: 22px; transition: transform .15s; flex-shrink: 0; }
.rom-lote.expanded .rom-seta { transform: rotate(90deg); color: var(--rom-texto); }
.rom-lote-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.rom-lote-protocolo { font-weight: 700; font-size: .98rem; color: var(--rom-texto); font-family: ui-monospace, Consolas, monospace; letter-spacing: .2px; }
.rom-lote-meta { font-size: .82rem; color: var(--rom-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rom-lote-class { font-size: .78rem; color: var(--rom-muted); }
.rom-sep { margin: 0 6px; color: #c3c8d0; }
.rom-lote-ver { font-size: .8rem; color: var(--rom-azul); font-weight: 500; white-space: nowrap; }
.rom-lote-toggle:hover .rom-lote-ver { text-decoration: underline; }
.rom-lote.expanded .rom-lote-cab { border-bottom: 1px solid var(--rom-borda); background: var(--rom-fundo); }
.rom-previa-nota { margin: 0; padding: 10px 16px 0; font-size: .8rem; color: var(--rom-muted); }
.rom-lote .romaneio-sheet-document { margin: 10px 16px 16px; }

@media (max-width: 640px) {
  .rom-busca { max-width: none; }
  .rom-topo .rom-btn { width: 100%; justify-content: center; }
  .rom-lote-cab { flex-wrap: wrap; padding: 0 12px 12px 0; }
  .rom-lote-ver { display: none; }
  .rom-lote-meta { white-space: normal; }
  .rom-lote-cab .rom-btn-primario { margin-left: 44px; }
  .rom-lote .romaneio-sheet-document { margin: 10px 8px 12px; }
}
`;

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

const Romaneio = () => {
  const [items, setItems] = useState<RomaneioItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [protocoloExpandido, setProtocoloExpandido] = useState<string | null>(null);
  const [erroCarregar, setErroCarregar] = useState('');
  const [imprimindo, setImprimindo] = useState<string | null>(null);

  const carregar = async () => {
    try {
      setIsLoading(true);
      setErroCarregar('');
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
        tipoOrc: row.tipo_orc ?? row.TIPO_ORC ?? row.tipoOrc,
        defeitoEncontrado: row.defeito_encontrado ?? row.DEFEITO_ENCONTRADO ?? row.defeitoEncontrado,
        pecasDesc: row.pecas_desc ?? row.PECAS_DESC ?? row.pecasDesc,
        statusText: row.status_text ?? row.STATUS_TEXT ?? row.statusText ?? null
      })) as RomaneioItem[];

      setItems(normalized);
    } catch {
      setErroCarregar('Não foi possível carregar os romaneios. Os dados exibidos podem estar desatualizados.');
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

  const imprimir = async (protocolo: string, itens: RomaneioItem[], criadoEm?: string) => {
    if (imprimindo) return;
    setImprimindo(protocolo);
    // QR por item: o Recebimento PA do RMS bipa e puxa serial, linha e classificacao.
    const itensComQr = await Promise.all(
      itens.map(async (item) => ({
        ...item,
        qrSvg: await gerarQrRomaneioSvg(item.protocolo || protocolo, item.serial).catch(() => '')
      }))
    ).finally(() => setImprimindo(null));
    const documento = buildRomaneioPrintDocument({
      protocolo,
      criadoEm: formatDateTime(criadoEm),
      items: itensComQr
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
    <div className="view-section romaneio-page rom-page">
      <style>{estiloRomaneio}</style>

      <div className="rom-topo no-print">
        <div>
          <h2 className="page-title rom-titulo">Romaneio</h2>
          <p className="rom-subtitulo">Imprima o romaneio de cada lote para acompanhar os produtos na devolução.</p>
        </div>
        <button className="rom-btn" type="button" onClick={() => void carregar()} disabled={isLoading}>
          <i className={`material-icons${isLoading ? ' rom-girando' : ''}`}>refresh</i>
          {isLoading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      <div className="rom-busca no-print">
        <i className="material-icons" aria-hidden="true">search</i>
        <input
          type="text"
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          placeholder="Buscar por protocolo, razão social ou Gemco"
          aria-label="Buscar romaneio"
        />
        {filtroTexto && (
          <button type="button" className="rom-busca-limpar" aria-label="Limpar busca" onClick={() => setFiltroTexto('')}>
            <i className="material-icons">close</i>
          </button>
        )}
      </div>

      {erroCarregar && (
        <div className="rom-erro no-print" role="alert">
          <i className="material-icons" aria-hidden="true">error_outline</i>
          <span>{erroCarregar}</span>
          <button type="button" className="rom-btn" onClick={() => void carregar()}>Tentar novamente</button>
        </div>
      )}

      {isLoading && filtrados.length === 0 && (
        <div className="rom-estado no-print" role="status">
          <span className="rom-spinner" aria-hidden="true" /> Carregando romaneios...
        </div>
      )}

      {!isLoading && !erroCarregar && filtrados.length === 0 && (
        <div className="rom-estado rom-vazio no-print">
          <i className="material-icons" aria-hidden="true">{filtroTexto.trim() ? 'search_off' : 'local_shipping'}</i>
          <p>
            {filtroTexto.trim()
              ? `Nenhum romaneio encontrado para "${filtroTexto.trim()}".`
              : 'Nenhum romaneio disponível ainda. Eles aparecem aqui depois que você envia um lote.'}
          </p>
        </div>
      )}

      <div className="romaneio-list rom-lista">
        {filtrados.map(([protocolo, itens]) => {
          const first = itens[0];
          const expanded = protocoloExpandido === protocolo;
          const grupos = agruparPorClassificacao(itens);
          const gerando = imprimindo === protocolo;
          let numero = 0;

          return (
            <section key={protocolo} className={`romaneio-sheet-shell rom-lote${expanded ? ' expanded' : ''}`}>
              <div className="rom-lote-cab no-print">
                <button
                  type="button"
                  className="rom-lote-toggle"
                  aria-expanded={expanded}
                  onClick={() => setProtocoloExpandido((current) => (current === protocolo ? null : protocolo))}
                >
                  <i className="material-icons rom-seta" aria-hidden="true">chevron_right</i>
                  <span className="rom-lote-id">
                    <span className="rom-lote-protocolo">{protocolo}</span>
                    <span className="rom-lote-meta">
                      {first?.razaoSocial || 'Magazine Luiza S.A'}
                      <span className="rom-sep">·</span>
                      {first?.criadoEm ? formatDateTime(first.criadoEm) : 'Sem data'}
                      <span className="rom-sep">·</span>
                      {itens.length === 1 ? '1 item' : `${itens.length} itens`}
                    </span>
                    <span className="rom-lote-class">
                      {grupos.map((grupo) => tituloGrupo(grupo.classificacao, grupo.itens.length)).join(' · ')}
                    </span>
                  </span>
                  <span className="rom-lote-ver">{expanded ? 'Ocultar prévia' : 'Ver prévia'}</span>
                </button>
                <button
                  className="rom-btn rom-btn-primario"
                  type="button"
                  disabled={Boolean(imprimindo)}
                  onClick={() => void imprimir(protocolo, itens, first?.criadoEm)}
                >
                  {gerando ? <span className="rom-spinner" aria-hidden="true" /> : <i className="material-icons">print</i>}
                  {gerando ? 'Gerando...' : 'Imprimir'}
                </button>
              </div>

              {expanded && (
                <>
                  <p className="rom-previa-nota no-print">
                    Prévia do documento. Confira os dados antes de imprimir.
                  </p>

                  <article className="romaneio-sheet-document">
                    <header className="romaneio-doc-top">
                      <div className="romaneio-doc-title-block">
                        <div className="romaneio-doc-title">ROMANEIO</div>
                        <div className="romaneio-doc-subtitle">Controle de itens em devolução do lote</div>
                      </div>
                      <div className="romaneio-doc-number">
                        <span>Nº</span>
                        <strong>{protocolo}</strong>
                      </div>
                    </header>

                    <section className="romaneio-destinatario">
                      <div className="romaneio-quadro">
                        <div className="romaneio-quadro-titulo">Destinatário</div>
                        <div className="romaneio-quadro-grid">
                          <div><span>Razão social</span><strong>{first?.razaoSocial || 'Magazine Luiza S.A'}</strong></div>
                          <div><span>CNPJ</span><strong>{first?.cnpj || '-'}</strong></div>
                          <div><span>Unidade</span><strong>{first?.unidade || '-'}</strong></div>
                          <div><span>E-mail retorno</span><strong>{first?.emailRetorno || '-'}</strong></div>
                        </div>
                      </div>
                    </section>

                    <section className="romaneio-infos-strip">
                      <div><span>Emissão</span><strong>{formatDateTime(first?.criadoEm)}</strong></div>
                      <div><span>Itens</span><strong>{itens.length}</strong></div>
                      <div><span>Documento</span><strong>Devolução</strong></div>
                    </section>

                    <p className="romaneio-resumo-classificacao">
                      <span>Por classificação:</span> {grupos.map((grupo) => tituloGrupo(grupo.classificacao, grupo.itens.length)).join(' · ')}
                    </p>

                    <section className="romaneio-tabela-wrap">
                      <table className="romaneio-print-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Identificação</th>
                            <th>Defeito / Motivo</th>
                            <th>Peças trocadas</th>
                            <th>Classificação</th>
                          </tr>
                        </thead>
                        {grupos.map((grupo) => (
                        <tbody key={grupo.classificacao}>
                          <tr className="romaneio-grupo-linha">
                            <td colSpan={5}>{tituloGrupo(grupo.classificacao, grupo.itens.length)}</td>
                          </tr>
                          {grupo.itens.map((item) => {
                            numero += 1;
                            return (
                            <tr key={item.id}>
                              <td>
                                <strong>{String(numero).padStart(2, '0')} - {item.descricao || '-'}</strong>
                                <div>{item.fornecedor || '-'}</div>
                                <div>Linha: {item.linha || '-'}</div>
                              </td>
                              <td>
                                <div><strong>Cód. barras:</strong> {item.codBarras || '-'}</div>
                                <div><strong>GEMCO:</strong> {item.codGemco || '-'}</div>
                                <div><strong>Serial:</strong> {item.serial || '-'}</div>
                              </td>
                              <td>{item.defeitoEncontrado || '-'}</td>
                              <td>{formatLista(item.pecasDesc, 'pe')}</td>
                              <td className="romaneio-col-classificacao">{item.tipoOrc || '-'}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                        ))}
                      </table>
                    </section>

                    <section className="romaneio-observacoes">
                      <div className="romaneio-quadro-titulo">Observação</div>
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
                        <span>Nº do romaneio</span>
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
