import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS } from '../lib/oracle';
import '../styles/pagamentos.css';

type Pagamento = {
  oracle_item_id: number; protocolo: string; cod_gemco?: string; descricao?: string; serial?: string;
  pagamento_status?: string; nota_fiscal_nome?: string; nota_fiscal_drive_link?: string;
  valor_pagamento?: number; nota_fiscal_numero?: string;
};
type UploadResponse = { folderLink?: string; files?: Array<{ id?: string }> };
const labels: Record<string, string> = { AGUARDANDO_NOTA: 'Aguardando nota', NOTA_ENVIADA: 'Nota enviada', EM_PAGAMENTO: 'Em pagamento', PAGO: 'Pago' };
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
  const [numero, setNumero] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [etapa, setEtapa] = useState('');
  const [aviso, setAviso] = useState<{ tipo: string; texto: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const sendingRef = useRef(false);
  const uploadedRef = useRef<{ file: File; item: number; link: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const profile = JSON.parse(localStorage.getItem('gat_user_profile') || '{}');
      const cnpj = String(profile.cnpj || '').replace(/\D/g, '');
      if (!cnpj) throw new Error('Não foi possível identificar seu CNPJ. Entre novamente no sistema.');
      const response = await oracleApi.get<Pagamento[]>(ORACLE_ENDPOINTS.getPagamentosSupabase, { params: { cnpj, _ts: Date.now() } });
      if (!Array.isArray(response.data)) throw new Error('Resposta inválida ao consultar os pagamentos.');
      setPagamentos(response.data);
    } catch (error) { setLoadError(mensagem(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const selecionar = (pagamento: Pagamento) => {
    if (enviando) return;
    setSelected(pagamento); setValor(pagamento.valor_pagamento != null ? String(pagamento.valor_pagamento) : '');
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
    const valorInformado = Number(valor.replace(',', '.'));
    if (!numero.trim() || !valor.trim() || !Number.isFinite(valorInformado) || valorInformado < 0 || !arquivo) {
      setAviso({ tipo: 'error', texto: 'Preencha o número e o valor da nota e anexe o PDF.' }); return;
    }
    sendingRef.current = true; setEnviando(true); setAviso(null);
    try {
      const referencia = selected.protocolo + '-' + selected.oracle_item_id;
      let link = uploadedRef.current?.file === arquivo && uploadedRef.current.item === selected.oracle_item_id ? uploadedRef.current.link : '';
      if (!link) {
        setEtapa('Enviando PDF…');
        const base64 = await toBase64(arquivo);
        const upload = await oracleApi.post<UploadResponse>(ORACLE_ENDPOINTS.uploadFotoDrive, {
          folderName: 'Pagamento_' + referencia,
          files: [{ name: 'NF_' + referencia + '_' + arquivo.name, mimeType: 'application/pdf', base64 }]
        }, { timeout: 55000 });
        link = driveLink(upload.data?.folderLink);
        if (!link || !upload.data?.files?.[0]?.id) throw new Error('O envio do PDF não foi confirmado.');
        uploadedRef.current = { file: arquivo, item: selected.oracle_item_id, link };
      }
      setEtapa('Registrando nota…');
      await oracleApi.post(ORACLE_ENDPOINTS.savePagamentoSupabase, {
        oracleItemId: selected.oracle_item_id, pagamentoReferencia: referencia,
        notaFiscalNome: arquivo.name, notaFiscalDriveLink: link,
        valorPagamento: valorInformado, notaFiscalNumero: numero.trim()
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
        <div><span className="pg-eyebrow">FINANCEIRO</span><h2>Pagamentos</h2><p>Selecione um orçamento finalizado e envie sua nota fiscal.</p></div>
        <button className="btn btn-secondary" type="button" disabled={loading || enviando} onClick={() => void carregar()}>Atualizar lista</button>
      </header>
      <div className="pg-summary">
        <div><span>Orçamentos finalizados</span><strong>{loading ? '—' : pagamentos.length}</strong></div>
        <div><span>Aguardando nota</span><strong>{loading ? '—' : pagamentos.filter((p) => !p.pagamento_status || p.pagamento_status === 'AGUARDANDO_NOTA').length}</strong></div>
        <div><span>Notas enviadas / em pagamento</span><strong>{loading ? '—' : pagamentos.filter((p) => ['NOTA_ENVIADA', 'EM_PAGAMENTO'].includes(p.pagamento_status || '')).length}</strong></div>
      </div>
      {loadError && <div className="pg-notice error" role="alert">{loadError}</div>}
      {aviso && <div className={'pg-notice ' + aviso.tipo} role={aviso.tipo === 'error' ? 'alert' : 'status'}>{aviso.texto}</div>}
      <div className="pg-layout">
        <section className="pg-panel" aria-label="Orçamentos finalizados">
          <div className="pg-panel-heading"><div><h3>Seus orçamentos</h3><p>Escolha um item para preencher a nota.</p></div><span className="pg-count">{filtrados.length}</span></div>
          <label className="pg-search"><span>Buscar orçamento</span><input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Protocolo, produto ou serial" /></label>
          <div className="pg-table-wrap"><table className="pg-table">
            <thead><tr><th>Orçamento / produto</th><th>Nota fiscal</th><th>Pagamento</th><th>Ação</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={4} className="pg-empty" role="status">Carregando orçamentos…</td></tr> : filtrados.length === 0 ? <tr><td colSpan={4} className="pg-empty">{busca ? 'Nenhum orçamento corresponde à busca.' : 'Os orçamentos finalizados aparecerão aqui.'}</td></tr> : filtrados.map((p) => (
                <tr key={p.oracle_item_id} className={selected?.oracle_item_id === p.oracle_item_id ? 'is-selected' : ''}>
                  <td><strong>{p.protocolo}</strong><span>{p.descricao || p.cod_gemco || 'Produto sem descrição'}</span><small>Item {p.oracle_item_id} · Serial {p.serial || '—'}</small></td>
                  <td>{p.nota_fiscal_numero ? <><strong>Nº {p.nota_fiscal_numero}</strong><span>{Number(p.valor_pagamento || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></> : <small>Não enviada</small>}{driveLink(p.nota_fiscal_drive_link) && <a href={driveLink(p.nota_fiscal_drive_link)} target="_blank" rel="noreferrer">Abrir documento ↗</a>}</td>
                  <td><span className={'pg-badge ' + (p.pagamento_status === 'PAGO' ? 'paid' : p.pagamento_status === 'NOTA_ENVIADA' ? 'sent' : '')}>{labels[p.pagamento_status || 'AGUARDANDO_NOTA'] || p.pagamento_status}</span></td>
                  <td><button type="button" className="pg-select" disabled={enviando} aria-pressed={selected?.oracle_item_id === p.oracle_item_id} onClick={() => selecionar(p)}>{selected?.oracle_item_id === p.oracle_item_id ? 'Selecionado' : 'Selecionar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
        <form className="pg-panel pg-form" ref={formRef} onSubmit={(event) => { event.preventDefault(); void enviar(); }}>
          <div className="pg-panel-heading"><div><span className="pg-eyebrow">ENVIO DE DOCUMENTO</span><h3>Nota fiscal</h3></div><i className="material-icons" aria-hidden="true">description</i></div>
          {selected ? <>
            <div className="pg-selected"><small>Orçamento selecionado</small><strong>{selected.protocolo} · Item {selected.oracle_item_id}</strong><span>{selected.descricao || selected.cod_gemco}</span></div>
            <fieldset disabled={enviando}>
              <label htmlFor="pg-numero">Número da nota fiscal<input id="pg-numero" required maxLength={80} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 000123" /></label>
              <label htmlFor="pg-valor">Valor da nota (R$)<input id="pg-valor" required type="number" min="0" step="0.01" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></label>
              <div className="pg-file-box"><i className="material-icons" aria-hidden="true">upload_file</i><strong>{arquivo ? arquivo.name : 'Anexe a nota fiscal'}</strong><small>{arquivo ? (arquivo.size / 1024).toFixed(0) + ' KB · Pronto para enviar' : 'Arquivo PDF · Até 3 MB'}</small>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => inputRef.current?.click()}>{arquivo ? 'Trocar arquivo' : 'Selecionar PDF'}</button>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden aria-label="Anexar nota fiscal em PDF" onChange={(e) => { anexar(e.target.files?.[0]); e.currentTarget.value = ''; }} />
              </div>
              <p className="pg-help">Confira os dados antes de enviar. O documento ficará vinculado a este orçamento.</p>
              <button className="btn btn-primary pg-submit" type="submit" disabled={!arquivo || !numero.trim() || !valor.trim()}>{enviando ? etapa : 'Enviar nota fiscal'}</button>
            </fieldset>
            {enviando && <p role="status" className="pg-help">{etapa} Aguarde a confirmação.</p>}
          </> : <div className="pg-form-empty"><i className="material-icons" aria-hidden="true">receipt_long</i><strong>Comece selecionando um orçamento</strong><p>Depois, informe o número e o valor da nota e anexe o PDF.</p></div>}
        </form>
      </div>
    </div>
  );
}
