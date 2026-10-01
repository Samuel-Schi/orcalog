import { useState } from 'react';
import { oracleApi } from '../lib/oracle';

export default function AcaoLotePosto({ acao, protocolo, id, onSaved }: {acao:'CONCLUIR'|'CANCELAR';protocolo:string;id?:string;onSaved:()=>void}) {
  const [aberto,setAberto]=useState(false);
  const [senha,setSenha]=useState('');
  const [erro,setErro]=useState('');
  const [salvando,setSalvando]=useState(false);
  const label=acao==='CANCELAR'?'Cancelar lançamento':'Conferir envio completo';
  const salvar=async()=>{
    setSalvando(true);setErro('');
    try {
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(senha));
      const senha_hash=btoa(String.fromCharCode(...new Uint8Array(hash)));
      await oracleApi.post('/.netlify/functions/lote-posto',{acao,protocolo,id,usuario:localStorage.getItem('gat_user'),senha_hash});
      setSenha('');setAberto(false);onSaved();
    } catch(error:any) {setErro(error.response?.data?.error || 'Não foi possível concluir. Tente novamente.');}
    finally {setSalvando(false);}
  };
  return <div>
    <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setAberto(!aberto)}>{label}</button>
    {aberto && <div className="card" style={{padding:12,marginTop:8}}>
      <p>{acao==='CANCELAR'?'Cancela apenas o lançamento antes da análise. O item e o protocolo serão preservados para corrigir e relançar pelo botão Editar.':'Confere todos os itens no servidor e libera o lote somente se o envio estiver completo.'}</p>
      <label>Confirme sua senha<input type="password" autoComplete="current-password" value={senha} onChange={e=>setSenha(e.target.value)} /></label>
      {erro && <p role="alert">{erro}</p>}
      <button type="button" disabled={salvando || !senha} className="btn btn-primary btn-sm" onClick={()=>void salvar()}>{salvando?'Aguarde…':'Confirmar'}</button>
      <button type="button" disabled={salvando} className="btn btn-secondary btn-sm" onClick={()=>{setAberto(false);setSenha('');setErro('');}}>Voltar</button>
    </div>}
  </div>;
}
