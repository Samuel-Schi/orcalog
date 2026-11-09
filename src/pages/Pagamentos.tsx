import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS } from '../lib/oracle';
import '../styles/pagamentos.css';

type Pagamento = {
  oracle_item_id: number | null; protocolo: string; cod_gemco?: string; descricao?: string; serial?: string;
  total_protocolo?: number; quantidade_itens?: number; itens_aprovados?: number; itens_reprovados?: number; item_ids?: number[];
  pagamento_status?: string; nota_fiscal_nome?: string; nota_fiscal_drive_link?: string;
  valor_pagamento?: number; nota_fiscal_numero?: string; kirk_numero?: string;
  produto_aprovado?: number; servico_aprovado?: number; produto_faturado?: number; servico_faturado?: number;
  produto_saldo?: number; servico_saldo?: number; possui_nota_sem_valor?: boolean;
  notas_fiscais?: Array<{tipo?: string; valor?: number; numero?: string; nome?: string; url?: string; pasta_id?: string; pasta_url?: string}>;
};
type UploadResponse = { folderId?: string; folderLink?: string; files?: Array<{ id?: string }> };
const labels: Record<string, string> = { AGUARDANDO_NOTA: 'Aguardando nota', NOTA_ENVIADA: 'Nota enviada', EM_VALIDACAO: 'Em validação', EM_PAGAMENTO: 'Em pagamento', PAGO: 'Pago' };
const money = (value: number | undefined) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const enviado = (p: Pagamento) => Number(p.produto_faturado || 0) + Number(p.servico_faturado || 0);
const pendente = (p: Pagamento) => Math.max(0, Number((Number(p.total_protocolo || 0) - enviado(p)).toFixed(2)));
// Pasta criada na primeira nota do protocolo; as próximas notas vão para ela.
const pastaDoProtocolo = (p: Pagamento) => p.notas_fiscais?.find((nota) => nota.pasta_id)?.pasta_id
  || driveLink(p.nota_fiscal_drive_link).match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] || '';
const pastaLink = (p: Pagamento) => { const id = pastaDoProtocolo(p); return id ? 'https://drive.google.com/drive/folders/' + id : driveLink(p.nota_fiscal_drive_link); };
// Aceita "1234,56", "1.234,56" ou "1234.56".
const parseValor = (texto: string) => {
  const limpo = texto.trim().replace(/\s|R\$/g, '');
  return Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
};
const driveLink = (value?: string) => {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && url.hostname === 'drive.google.com' ? url.href : ''; } catch { return ''; }
};
const mensagem = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data?.error === 'string') return error.response.data.error;
    return error.response?.status === 404 ? 'O serviço de envio não foi encontrado. Atualize a página e tente novamente.' : 'Não foi possível concluir a operação. Tente novamente.';
  }
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
};
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.onerror = () => reject(new Error('Não foi possível ler o PDF.'));
  reader.readAsDataURL(file);
});

export default function Pagamentos() {
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Pagamento | null>(null);
  const [busca, setBusca] = useState('');
  const [valor, setValor] = useState('');
  const [tipoNota, setTipoNota] = useState<'PRODUTO' | 'SERVICO'>('PRODUTO');
  const [numero, setNumero] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [etapa, setEtapa] = useState('');
  const [aviso, setAviso] = useState<{ tipo: string; texto: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sendingRef = useRef(false);
  const uploadedRef = useRef<{ file: File; protocolo: string; link: string; arquivoId: string; pastaId: string } | null>(null);
  const cnpjRef = useRef('');

  const carregar = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const profile = JSON.parse(localStorage.getItem('gat_user_profile') || '{}');
      const cnpj = String(profile.cnpj || '').replace(/\D/g, '');
      if (!cnpj) throw new Error('Não foi possível identificar seu CNPJ. Entre novamente no sistema.');
      cnpjRef.current = cnpj;
      const response = await oracleApi.get<Pagamento[]>(ORACLE_ENDPOINTS.getPagamentosSupabase, { params: { cnpj, _ts: Date.now() } });
      if (!Array.isArray(response.data)) throw new Error('Resposta inválida ao consultar os pagamentos.');
      setPagamentos(response.data);
    } catch (error) { setLoadError(mensagem(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const selecionar = (pagamento: Pagamento) => {
    if (enviando) return;
    setSelected(pagamento); setValor(''); setTipoNota('PRODUTO');
    setNumero(pagamento.nota_fiscal_numero || ''); setArquivo(null); setAviso(null);
    uploadedRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const anexar = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      setAviso({ tipo: 'error', texto: 'Selecione uma nota fiscal em PDF.' }); return;
    }
    if (!file.size || file.size > 3_000_000) {
      setAviso({ tipo: 'error', texto: 'Selecione um PDF de até 3 MB que não esteja vazio.' }); return;
    }
    uploadedRef.current = null; setArquivo(file); setAviso(null);
  };
  const enviar = async () => {
    if (sendingRef.current || !selected) return;
    const valorInformado = parseValor(valor);
    const saldo = tipoNota === 'PRODUTO' ? Number(selected.produto_saldo || 0) : Number(selected.servico_saldo || 0);
    if (!numero.trim() || !valor.trim() || !Number.isFinite(valorInformado) || valorInformado <= 0 || !arquivo) {
      setAviso({ tipo: 'error', texto: 'Preencha o número e o valor da nota e anexe o PDF.' }); return;
    }
    if (valorInformado - saldo > 0.005) {
      setAviso({ tipo: 'error', texto: 'O valor da nota não pode ultrapassar o total aprovado do protocolo.' }); return;
    }
    sendingRef.current = true; setEnviando(true); setAviso(null);
    try {
      const referencia = selected.protocolo;
      let link = uploadedRef.current?.file === arquivo && uploadedRef.current.protocolo === selected.protocolo ? uploadedRef.current.link : '';
      let arquivoId = uploadedRef.current?.file === arquivo && uploadedRef.current.protocolo === selected.protocolo ? uploadedRef.current.arquivoId : '';
      let pastaId = uploadedRef.current?.file === arquivo && uploadedRef.current.protocolo === selected.protocolo ? uploadedRef.current.pastaId : '';
      if (!link) {
        setEtapa('Enviando PDF…');
        const base64 = await toBase64(arquivo);
        const upload = await oracleApi.post<UploadResponse>(ORACLE_ENDPOINTS.uploadFotoDrive, {
          folderName: 'Pagamento_' + referencia,
          folderId: pastaDoProtocolo(selected) || undefined,
          publicFolder: true,
          files: [{ name: 'NF_' + tipoNota + '_' + referencia + '_' + arquivo.name, mimeType: 'application/pdf', base64 }]
        }, { timeout: 55000 });
        link = driveLink(upload.data?.folderLink);
        arquivoId = String(upload.data?.files?.[0]?.id || '');
        pastaId = String(upload.data?.folderId || '');
        if (!link || !arquivoId) throw new Error('O envio do PDF não foi confirmado.');
        uploadedRef.current = { file: arquivo, protocolo: selected.protocolo, link, arquivoId, pastaId };
      }
      setEtapa('Registrando nota…');
      await oracleApi.post(ORACLE_ENDPOINTS.savePagamentoSupabase, {
        protocolo: selected.protocolo, cnpj: cnpjRef.current, pagamentoReferencia: referencia,
        notaFiscalNome: arquivo.name, notaFiscalDriveLink: link,
        valorPagamento: valorInformado, notaFiscalNumero: numero.trim(), notaFiscalArquivoId: arquivoId, notaFiscalPastaId: pastaId, tipoNota
      });
      setAviso({ tipo: 'success', texto: 'Nota ' + numero.trim() + ' enviada para o orçamento ' + selected.protocolo + '.' });
      setSelected(null); setArquivo(null); uploadedRef.current = null;
      await carregar();
    } catch (error) { setAviso({ tipo: 'error', texto: mensagem(error) }); }
    finally { sendingRef.current = false; setEnviando(false); }
  };
  const filtrados = pagamentos.filter((p) => (p.protocolo + ' ' + (p.descricao || '') + ' ' + (p.serial || '')).toLowerCase().includes(busca.toLowerCase()));
  const qtdAguardando = pagamentos.filter((p) => !p.pagamento_status || p.pagamento_status === 'AGUARDANDO_NOTA').length;
  const qtdEmAndamento = pagamentos.filter((p) => ['NOTA_ENVIADA', 'EM_VALIDACAO', 'EM_PAGAMENTO'].includes(p.pagamento_status || '')).length;
  const qtdPago = pagamentos.filter((p) => p.pagamento_status === 'PAGO').length;
  const saldoTotal = pagamentos.reduce((soma, p) => soma + pendente(p), 0);
  const badgeClasse = (status?: string) =>
    status === 'PAGO' ? ' paid' : status === 'NOTA_ENVIADA' || status === 'EM_VALIDACAO' || status === 'EM_PAGAMENTO' ? ' sent' : '';
  const saldoTipo = selected ? Number((tipoNota === 'PRODUTO' ? selected.produto_saldo : selected.servico_saldo) || 0) : 0;
  const fecharSelecao = () => {
    if (enviando) return;
    setSelected(null); setArquivo(null); setValor(''); uploadedRef.current = null;
  };
  return (
    <div className="view-section pagamentos-page">
      <header className="pg-heading">
        <div>
          <h2 className="page-title pg-titulo">Pagamentos</h2>
          <p>Escolha um protocolo finalizado e envie a nota fiscal para receber.</p>
        </div>
        <button className="pg-btn" type="button" disabled={loading || enviando} onClick={() => void carregar()}>
          <i className={`material-icons${loading ? ' pg-girando' : ''}`}>refresh</i>
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </header>

      {!loading && pagamentos.length > 0 && (
        <div className="pg-resumo">
          <span><strong>{pagamentos.length}</strong> protocolo{pagamentos.length === 1 ? '' : 's'}</span>
          <span className={qtdAguardando ? 'pg-resumo-atencao' : undefined}><strong>{qtdAguardando}</strong> aguardando nota</span>
          <span><strong>{qtdEmAndamento}</strong> em análise ou pagamento</span>
          <span><strong>{qtdPago}</strong> pago{qtdPago === 1 ? '' : 's'}</span>
          <span className="pg-resumo-total">Saldo a faturar <strong>{money(saldoTotal)}</strong></span>
        </div>
      )}

      {loadError && (
        <div className="pg-notice error" role="alert">
          <i className="material-icons" aria-hidden="true">error_outline</i>
          <span>{loadError}</span>
          <button type="button" className="pg-btn" onClick={() => void carregar()}>Tentar novamente</button>
        </div>
      )}
      {aviso && (
        <div className={'pg-notice ' + aviso.tipo} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
          <i className="material-icons" aria-hidden="true">{aviso.tipo === 'success' ? 'check_circle' : 'error_outline'}</i>
          <span>{aviso.texto}</span>
          <button type="button" className="pg-notice-fechar" aria-label="Fechar aviso" onClick={() => setAviso(null)}>
            <i className="material-icons">close</i>
          </button>
        </div>
      )}

      <div className="pg-layout">
        <section className="pg-panel" aria-label="Orçamentos finalizados">
          <div className="pg-panel-heading">
            <h3>Seus protocolos <span className="pg-count">{filtrados.length}</span></h3>
            <div className="pg-search">
              <i className="material-icons" aria-hidden="true">search</i>
              <input type="search" aria-label="Buscar protocolo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Protocolo, produto ou serial" />
            </div>
          </div>
          <div className="pg-table-wrap"><table className="pg-table">
            <thead><tr><th>Protocolo</th><th className="pg-num">Total aprovado</th><th>Nota fiscal</th><th className="pg-num">Saldo pendente</th><th>Situação</th><th aria-label="Ação" /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="pg-empty" role="status"><span className="pg-spinner" aria-hidden="true" /> Carregando protocolos...</td></tr>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={6} className="pg-empty">{busca ? 'Nenhum protocolo corresponde à busca.' : 'Os protocolos finalizados aparecem aqui quando a análise terminar.'}</td></tr>
              ) : filtrados.map((p) => {
                const ativo = selected?.protocolo === p.protocolo;
                const saldo = pendente(p);
                return (
                <tr key={p.protocolo} className={ativo ? 'is-selected' : ''} onClick={() => selecionar(p)}>
                  <td>
                    <strong className="pg-protocolo">{p.protocolo}</strong>
                    <span className="pg-desc" title={p.descricao || ''}>{p.descricao || p.cod_gemco || 'Produto sem descrição'}</span>
                    <small>{p.quantidade_itens || 1} item(ns) · {p.itens_aprovados || 0} aprovado(s){p.itens_reprovados ? ' · ' + p.itens_reprovados + ' reprovado(s)' : ''}</small>
                  </td>
                  <td className="pg-num"><strong>{money(p.total_protocolo)}</strong></td>
                  <td>
                    {p.nota_fiscal_numero ? <><strong>Nº {p.nota_fiscal_numero}</strong><small>{money(p.valor_pagamento)}</small></> : <small>Não enviada</small>}
                    {pastaLink(p) && <a href={pastaLink(p)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Ver notas</a>}
                  </td>
                  <td className="pg-num">
                    <strong className={saldo > 0 ? 'pg-saldo-aberto' : 'pg-saldo-zerado'}>{money(saldo)}</strong>
                    <small>{enviado(p) > 0 ? 'Enviado ' + money(enviado(p)) : 'Nada enviado'}</small>
                  </td>
                  <td><span className={'pg-badge' + badgeClasse(p.pagamento_status)}>{labels[p.pagamento_status || 'AGUARDANDO_NOTA'] || p.pagamento_status}</span></td>
                  <td>
                    <button type="button" className="pg-select" disabled={enviando} aria-pressed={ativo} onClick={(e) => { e.stopPropagation(); selecionar(p); }}>
                      {ativo ? 'Selecionado' : 'Enviar nota'}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>

        <form className="pg-panel pg-form" ref={formRef} onSubmit={(event) => { event.preventDefault(); void enviar(); }}>
          <div className="pg-panel-heading">
            <h3>Nota fiscal</h3>
            {selected && (
              <button type="button" className="pg-notice-fechar" aria-label="Cancelar seleção" disabled={enviando} onClick={fecharSelecao}>
                <i className="material-icons">close</i>
              </button>
            )}
          </div>
          {selected ? <>
            <div className="pg-selected">
              <div className="pg-selected-topo">
                <strong className="pg-protocolo">{selected.protocolo}</strong>
                <span>{selected.quantidade_itens || 1} item(ns)</span>
              </div>
              <dl className="pg-saldos">
                <div><dt>Aprovado</dt><dd>{money(selected.total_protocolo)}</dd></div>
                <div><dt>Enviado</dt><dd>{money(enviado(selected))}</dd></div>
                <div><dt>Saldo pendente</dt><dd className="pg-saldo-aberto">{money(pendente(selected))}</dd></div>
              </dl>
            </div>
            {selected.possui_nota_sem_valor && <p className="pg-notice error pg-notice-form">Há uma nota antiga sem valor registrado. Regularize-a antes de enviar uma nota parcial.</p>}
            <fieldset disabled={enviando}>
              <span className="pg-label">Tipo da nota</span>
              <div className="pg-tipo-nota" role="group" aria-label="Tipo da nota fiscal">
                <button type="button" aria-pressed={tipoNota === 'PRODUTO'} onClick={() => { setTipoNota('PRODUTO'); setValor(''); }}>
                  Produto<small>Saldo {money(selected.produto_saldo)}</small>
                </button>
                <button type="button" aria-pressed={tipoNota === 'SERVICO'} onClick={() => { setTipoNota('SERVICO'); setValor(''); }}>
                  Serviço<small>Saldo {money(selected.servico_saldo)}</small>
                </button>
              </div>
              <label htmlFor="pg-numero">Número da nota fiscal<input id="pg-numero" required maxLength={80} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 000123" /></label>
              <div className="pg-campo">
                <div className="pg-label-linha">
                  <label htmlFor="pg-valor">Valor da nota (R$)</label>
                  {saldoTipo > 0 && (
                    <button type="button" className="pg-link" onClick={() => setValor(saldoTipo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}>
                      Usar saldo {money(saldoTipo)}
                    </button>
                  )}
                </div>
                <input id="pg-valor" required type="text" inputMode="decimal" autoComplete="off" maxLength={20} value={valor} onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setValor(e.target.value); }} placeholder="Ex.: 300,00" />
              </div>
              <div
                className={'pg-file-box' + (arquivo ? ' has-file' : '')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (!enviando) anexar(e.dataTransfer.files?.[0]); }}
              >
                <i className="material-icons" aria-hidden="true">{arquivo ? 'picture_as_pdf' : 'upload_file'}</i>
                <div className="pg-file-texto">
                  <strong>{arquivo ? arquivo.name : 'Arraste o PDF da nota aqui'}</strong>
                  <small>{arquivo ? (arquivo.size / 1024).toFixed(0) + ' KB' : 'PDF de até 3 MB'}</small>
                </div>
                <button className="pg-btn pg-btn-sm" type="button" onClick={() => inputRef.current?.click()}>{arquivo ? 'Trocar' : 'Selecionar'}</button>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden aria-label="Anexar nota fiscal em PDF" onChange={(e) => { anexar(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </div>
              <p className="pg-help">Pode enviar uma nota parcial. O valor não pode passar do saldo do tipo escolhido.</p>
              <button className="pg-btn pg-btn-primario pg-submit" type="submit" disabled={selected.possui_nota_sem_valor || !arquivo || !numero.trim() || !valor.trim()}>
                {enviando ? <><span className="pg-spinner" aria-hidden="true" /> {etapa}</> : `Enviar nota de ${tipoNota === 'PRODUTO' ? 'produto' : 'serviço'}`}
              </button>
            </fieldset>
            {enviando && <p role="status" className="pg-help pg-help-centro">Aguarde a confirmação, não feche a página.</p>}
          </> : (
            <div className="pg-form-empty">
              <i className="material-icons" aria-hidden="true">receipt_long</i>
              <strong>Nenhum protocolo selecionado</strong>
              <p>Clique em um protocolo da lista para enviar a nota fiscal dele.</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
