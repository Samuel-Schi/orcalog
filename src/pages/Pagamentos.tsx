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
  return (
    <div className="view-section pagamentos-page">
      <header className="pg-heading">
        <div><span className="pg-eyebrow">FINANCEIRO</span><h2>Pagamentos</h2><p>Selecione um protocolo finalizado e envie sua nota fiscal.</p></div>
        <button className="btn btn-secondary" type="button" disabled={loading || enviando} onClick={() => void carregar()}>Atualizar lista</button>
      </header>
      <div className="pg-summary">
        <div><span>Protocolos finalizados</span><strong>{loading ? '—' : pagamentos.length}</strong></div>
        <div><span>Aguardando nota</span><strong>{loading ? '—' : pagamentos.filter((p) => !p.pagamento_status || p.pagamento_status === 'AGUARDANDO_NOTA').length}</strong></div>
        <div><span>Notas enviadas / em pagamento</span><strong>{loading ? '—' : pagamentos.filter((p) => ['NOTA_ENVIADA', 'EM_PAGAMENTO'].includes(p.pagamento_status || '')).length}</strong></div>
      </div>
      {loadError && <div className="pg-notice error" role="alert">{loadError}</div>}
      {aviso && <div className={'pg-notice ' + aviso.tipo} role={aviso.tipo === 'error' ? 'alert' : 'status'}>{aviso.texto}</div>}
      <div className="pg-layout">
        <section className="pg-panel" aria-label="Orçamentos finalizados">
          <div className="pg-panel-heading"><div><h3>Seus protocolos</h3><p>Escolha um protocolo para preencher a nota.</p></div><span className="pg-count">{filtrados.length}</span></div>
          <label className="pg-search"><span>Buscar protocolo</span><input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Protocolo, produto ou serial" /></label>
          <div className="pg-table-wrap"><table className="pg-table">
            <thead><tr><th>Protocolo / itens</th><th>Total aprovado</th><th>Nota fiscal</th><th>Saldo pendente</th><th>Pagamento</th><th>Ação</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="pg-empty" role="status">Carregando protocolos…</td></tr> : filtrados.length === 0 ? <tr><td colSpan={6} className="pg-empty">{busca ? 'Nenhum protocolo corresponde à busca.' : 'Os protocolos finalizados aparecerão aqui.'}</td></tr> : filtrados.map((p) => (
                <tr key={p.protocolo} className={selected?.protocolo === p.protocolo ? 'is-selected' : ''}>
                  <td><strong>{p.protocolo}</strong><span>{p.descricao || p.cod_gemco || 'Produto sem descrição'}</span><small>{p.quantidade_itens || 1} item(ns) · {p.itens_aprovados || 0} aprovado(s){p.itens_reprovados ? ' · ' + p.itens_reprovados + ' reprovado(s)' : ''}</small></td>
                  <td><strong>{Number(p.total_protocolo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong><small>Limite máximo da nota</small></td>
                  <td>{p.nota_fiscal_numero ? <><strong>Nº {p.nota_fiscal_numero}</strong><span>{Number(p.valor_pagamento || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></> : <small>Não enviada</small>}{pastaLink(p) && <a href={pastaLink(p)} target="_blank" rel="noreferrer">Abrir pasta das notas ↗</a>}</td>
                  <td><strong>{money(pendente(p))}</strong><small>{enviado(p) > 0 ? 'Enviado ' + money(enviado(p)) : 'Nenhuma nota enviada'}</small></td>
                  <td><span className={'pg-badge' + (p.pagamento_status === 'PAGO' ? 'paid' : p.pagamento_status === 'NOTA_ENVIADA' ? 'sent' : '')}>{labels[p.pagamento_status || 'AGUARDANDO_NOTA'] || p.pagamento_status}</span></td>
                  <td><button type="button" className="pg-select" disabled={enviando} aria-pressed={selected?.protocolo === p.protocolo} onClick={() => selecionar(p)}>{selected?.protocolo === p.protocolo ? 'Selecionado' : 'Selecionar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
        <form className="pg-panel pg-form" ref={formRef} onSubmit={(event) => { event.preventDefault(); void enviar(); }}>
          <div className="pg-panel-heading"><div><span className="pg-eyebrow">ENVIO DE DOCUMENTO</span><h3>Nota fiscal</h3></div><i className="material-icons" aria-hidden="true">description</i></div>
          {selected ? <>
            <div className="pg-selected"><small>Protocolo selecionado</small><strong>{selected.protocolo}</strong><span>{money(selected.total_protocolo)} aprovados · {selected.quantidade_itens || 1} item(ns)</span><span>Enviado {money(enviado(selected))} · <b>Saldo pendente {money(pendente(selected))}</b></span></div>
            <div className="pg-financeiro-resumo" aria-label="Saldos para faturamento">
              <div><strong>Produtos</strong><span>Aprovado {money(selected.produto_aprovado)} · Faturado {money(selected.produto_faturado)}</span><b>Saldo {money(selected.produto_saldo)}</b></div>
              <div><strong>Serviços</strong><span>Aprovado {money(selected.servico_aprovado)} · Faturado {money(selected.servico_faturado)}</span><b>Saldo {money(selected.servico_saldo)}</b></div>
            </div>
            {selected.possui_nota_sem_valor && <p className="pg-notice error">Há uma nota antiga sem valor registrado. Regularize-a antes de enviar uma nota parcial.</p>}
            <fieldset disabled={enviando}>
              <div className="pg-tipo-nota" role="group" aria-label="Tipo da nota fiscal"><button type="button" aria-pressed={tipoNota === 'PRODUTO'} onClick={() => { setTipoNota('PRODUTO'); setValor(''); }}>Nota de produto</button><button type="button" aria-pressed={tipoNota === 'SERVICO'} onClick={() => { setTipoNota('SERVICO'); setValor(''); }}>Nota de serviço</button></div>
              <label htmlFor="pg-numero">Número da nota fiscal<input id="pg-numero" required maxLength={80} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 000123" /></label>
              <label htmlFor="pg-valor">Valor da nota de {tipoNota === 'PRODUTO' ? 'produto' : 'serviço'} (R$)<input id="pg-valor" required type="text" inputMode="decimal" autoComplete="off" maxLength={20} value={valor} onChange={(e) => { if (/^[\d.,]*$/.test(e.target.value)) setValor(e.target.value); }} placeholder="Ex.: 300,00" /></label>
              <div className="pg-file-box"><i className="material-icons" aria-hidden="true">upload_file</i><strong>{arquivo ? arquivo.name : 'Anexe a nota fiscal'}</strong><small>{arquivo ? (arquivo.size / 1024).toFixed(0) + ' KB · Pronto para enviar' : 'Arquivo PDF · Até 3 MB'}</small>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => inputRef.current?.click()}>{arquivo ? 'Trocar arquivo' : 'Selecionar PDF'}</button>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden aria-label="Anexar nota fiscal em PDF" onChange={(e) => { anexar(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </div>
              <p className="pg-help">Envio parcial é permitido. Saldo disponível: <strong>{money(tipoNota === 'PRODUTO' ? selected.produto_saldo : selected.servico_saldo)}</strong>. O banco bloqueia valores acima do saldo.</p>
              <button className="btn btn-primary pg-submit" type="submit" disabled={selected.possui_nota_sem_valor || !arquivo || !numero.trim() || !valor.trim()}>{enviando ? etapa : `Enviar nota de ${tipoNota === 'PRODUTO' ? 'produto' : 'serviço'}`}</button>
            </fieldset>
            {enviando && <p role="status" className="pg-help">{etapa} Aguarde a confirmação.</p>}
          </> : <div className="pg-form-empty"><i className="material-icons" aria-hidden="true">receipt_long</i><strong>Comece selecionando um protocolo</strong><p>Depois, informe o número e o valor da nota e anexe o PDF.</p></div>}
        </form>
      </div>
    </div>
  );
}
