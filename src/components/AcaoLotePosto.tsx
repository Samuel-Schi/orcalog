import { useState } from 'react';
import { oracleApi } from '../lib/oracle';
import PopupAviso, { type AvisoPopup } from './PopupAviso';

type Props = {
  acao: 'CONCLUIR' | 'CANCELAR';
  protocolo: string;
  cnpj: string;
  ids?: string[];
  id?: string;
  onSaved: () => void;
};

export default function AcaoLotePosto({ acao, protocolo, cnpj, ids = [], id, onSaved }: Props) {
  const [aviso, setAviso] = useState<AvisoPopup | null>(null);
  const [salvando, setSalvando] = useState(false);
  const finalizar = acao === 'CONCLUIR';

  const salvar = async () => {
    if (!finalizar && !window.confirm('Cancelar este lançamento? Ele poderá ser relançado enquanto o lote estiver pendente.')) return;
    setSalvando(true);
    try {
      await oracleApi.post('/.netlify/functions/lote-posto', { acao, protocolo, cnpj, ids, id });
      setAviso(finalizar
        ? { tipo: 'sucesso', titulo: 'Lote finalizado!', mensagem: `O lote ${protocolo} foi enviado para a análise da AT. Acompanhe o resultado aqui em Meus Envios.` }
        : { tipo: 'sucesso', titulo: 'Lançamento cancelado', mensagem: 'Você pode relançar o item enquanto o lote estiver pendente.' });
    } catch (error: any) {
      setAviso({ tipo: 'erro', titulo: finalizar ? 'Não foi possível finalizar o lote' : 'Não foi possível cancelar',
        mensagem: error.response?.data?.error || 'Tente novamente em instantes.' });
    } finally {
      setSalvando(false);
    }
  };

  // A lista só recarrega ao fechar o pop-up: assim o posto lê a confirmação antes do lote mudar de aba.
  const fechar = () => {
    const deuCerto = aviso?.tipo === 'sucesso';
    setAviso(null);
    if (deuCerto) onSaved();
  };

  return <span className="acao-lote-posto" onClick={(event) => event.stopPropagation()}>
    <button type="button" className={finalizar ? 'btn btn-success btn-sm acao-lote-finalizar' : 'btn btn-secondary btn-sm'} disabled={salvando} onClick={() => void salvar()}>
      {finalizar && <i className="material-icons" aria-hidden="true">task_alt</i>}
      {salvando ? 'Aguarde...' : finalizar ? 'Finalizar lote' : 'Cancelar lançamento'}
    </button>
    <PopupAviso aviso={aviso} onClose={fechar} />
  </span>;
}
