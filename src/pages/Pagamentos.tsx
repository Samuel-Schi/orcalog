import { useCallback, useEffect, useRef, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS } from '../lib/oracle';

type Pagamento = {
  oracle_item_id: number;
  protocolo: string;
  cod_gemco?: string;
  descricao?: string;
  serial?: string;
  total_orcamento?: number;
  pagamento_status?: string;
  pagamento_referencia?: string;
  nota_fiscal_nome?: string;
  nota_fiscal_drive_link?: string;
  nota_fiscal_enviada_em?: string;
};

type DriveUploadResponse = {
  folderLink?: string;
  files?: Array<{ id?: string }>;
};

const MAX_PDF_BASE64_LENGTH = 4_000_000;

const getCnpj = () => {
  try {
    const profile = JSON.parse(localStorage.getItem('gat_user_profile') || '{}') as { cnpj?: string };
    return String(profile.cnpj || '').replace(/\D/g, '');
  } catch {
    return '';
  }
};

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const value = String(reader.result || '').split(',')[1] || '';
    value ? resolve(value) : reject(new Error('Não foi possível ler o PDF.'));
  };
  reader.onerror = () => reject(new Error('Não foi possível ler o PDF.'));
  reader.readAsDataURL(file);
});

const statusLabel = (status?: string) => {
  const labels: Record<string, string> = {
    AGUARDANDO_NOTA: 'Aguardando nota',
    NOTA_ENVIADA: 'Nota enviada',
    EM_PAGAMENTO: 'Em pagamento',
    PAGO: 'Pago'
  };
  return labels[String(status || 'AGUARDANDO_NOTA').toUpperCase()] || String(status || 'Aguardando nota');
};

const Pagamentos = () => {
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingPagamentoRef = useRef<Pagamento | null>(null);

  const carregar = useCallback(async () => {
    const cnpj = getCnpj();
    if (!cnpj) {
      setToast({ type: 'error', message: 'Não foi possível identificar o CNPJ deste usuário.' });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = await oracleApi.get<Pagamento[]>(ORACLE_ENDPOINTS.getPagamentosSupabase, {
        params: { cnpj, _ts: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
      });
      setPagamentos(Array.isArray(response.data) ? response.data : []);
    } catch {
      setToast({ type: 'error', message: 'Não foi possível carregar os pagamentos.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const selecionarNota = (pagamento: Pagamento) => {
    pendingPagamentoRef.current = pagamento;
    inputRef.current?.click();
  };

  const enviarNota = async (file?: File) => {
    const pagamento = pendingPagamentoRef.current;
    pendingPagamentoRef.current = null;
    if (!file || !pagamento) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setToast({ type: 'error', message: 'Selecione somente um arquivo PDF da nota fiscal.' });
      return;
    }

    try {
      setUploadingId(pagamento.oracle_item_id);
      const base64 = await toBase64(file);
      if (base64.length > MAX_PDF_BASE64_LENGTH) throw new Error('O PDF é grande demais. Envie um arquivo de até aproximadamente 3 MB.');

      const referencia = `${pagamento.protocolo}-${pagamento.oracle_item_id}`;
      const upload = await oracleApi.post<DriveUploadResponse>(
        ORACLE_ENDPOINTS.uploadFotoDrive,
        {
          folderName: `Pagamento_${referencia}`,
          files: [{ name: `NF_${referencia}_${file.name}`, mimeType: 'application/pdf', base64 }]
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 55000 }
      );
      const driveLink = String(upload.data?.folderLink || '');
      if (!driveLink || !upload.data?.files?.[0]?.id) throw new Error('O Drive não confirmou o envio do PDF.');

      await oracleApi.post(ORACLE_ENDPOINTS.savePagamentoSupabase, {
        oracleItemId: pagamento.oracle_item_id,
        pagamentoReferencia: referencia,
        notaFiscalNome: file.name,
        notaFiscalDriveLink: driveLink
      }, { headers: { 'Content-Type': 'application/json' } });
      setToast({ type: 'success', message: 'Nota fiscal enviada e vinculada ao pagamento.' });
      await carregar();
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'Não foi possível enviar a nota fiscal.' });
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="view-section pagamentos-page">
      <div className="romaneio-page-top">
        <div>
          <h2 className="page-title romaneio-page-title">Pagamentos</h2>
          <p className="novo-orcamento-help">Envie a nota fiscal em PDF para cada item. Uma pasta exclusiva será criada no Drive para o pagamento.</p>
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void carregar()} disabled={loading}>Atualizar</button>
      </div>

      <div className="card">
        {loading ? <div>Carregando pagamentos...</div> : (
          <div className="table-scroll">
            <table className="tabela-horizontal">
              <thead><tr><th>Referência</th><th>Produto</th><th>Serial</th><th>Valor</th><th>Status</th><th>Nota fiscal</th><th>Ação</th></tr></thead>
              <tbody>
                {pagamentos.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center' }}>Nenhum item disponível para pagamento.</td></tr>}
                {pagamentos.map((pagamento) => {
                  const referencia = pagamento.pagamento_referencia || `${pagamento.protocolo}-${pagamento.oracle_item_id}`;
                  const enviando = uploadingId === pagamento.oracle_item_id;
                  return <tr key={pagamento.oracle_item_id}>
                    <td><strong>{referencia}</strong></td>
                    <td>{pagamento.descricao || pagamento.cod_gemco || '-'}</td>
                    <td>{pagamento.serial || '-'}</td>
                    <td>{Number(pagamento.total_orcamento || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td><span className="status-badge" style={{ background: pagamento.pagamento_status === 'PAGO' ? 'var(--status-finalizado)' : 'var(--status-pendente)' }}>{statusLabel(pagamento.pagamento_status)}</span></td>
                    <td>{pagamento.nota_fiscal_drive_link ? <a href={pagamento.nota_fiscal_drive_link} target="_blank" rel="noreferrer">{pagamento.nota_fiscal_nome || 'Abrir pasta'}</a> : '-'}</td>
                    <td><button className="btn btn-primary btn-sm" type="button" onClick={() => selecionarNota(pagamento)} disabled={enviando}>{enviando ? 'Enviando...' : 'Enviar PDF'}</button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="fotos-drive-input" onChange={(event) => { void enviarNota(event.target.files?.[0]); event.currentTarget.value = ''; }} />
      {toast && <div className="toast-container"><div className={`toast ${toast.type === 'success' ? 'toast-success' : 'toast-error'}`}><div className="toast-title">{toast.type === 'success' ? 'Sucesso' : 'Erro'}</div><div className="toast-message">{toast.message}</div></div></div>}
    </div>
  );
};

export default Pagamentos;
