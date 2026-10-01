import { useState } from 'react';
import { oracleApi } from '../lib/oracle';

type Props = {
  acao: 'CONCLUIR' | 'CANCELAR';
  protocolo: string;
  cnpj: string;
  ids?: string[];
  id?: string;
  onSaved: () => void;
};

export default function AcaoLotePosto({ acao, protocolo, cnpj, ids = [], id, onSaved }: Props) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const finalizar = acao === 'CONCLUIR';

  const salvar = async () => {
    if (!finalizar && !window.confirm('Cancelar este lancamento? Ele podera ser relancado enquanto o lote estiver pendente.')) return;
    setSalvando(true);
    setErro('');
    try {
      await oracleApi.post('/.netlify/functions/lote-posto', { acao, protocolo, cnpj, ids, id });
      onSaved();
    } catch (error: any) {
      setErro(error.response?.data?.error || 'Nao foi possivel atualizar o lote. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  return <span className="acao-lote-posto">
    <button type="button" className={finalizar ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} disabled={salvando} onClick={(event) => { event.stopPropagation(); void salvar(); }}>
      {salvando ? 'Aguarde...' : finalizar ? 'Finalizar' : 'Cancelar lancamento'}
    </button>
    {erro && <small role="alert">{erro}</small>}
  </span>;
}
