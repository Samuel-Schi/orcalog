import { useEffect, useMemo, useState } from 'react';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

type Item = {
  id: string;
  nf: string;
  data: string;
  codGemco: string;
  descricao: string;
  total: number;
};

const NovoOrcamento = () => {
  const [protocolo, setProtocolo] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [nfRemessa, setNfRemessa] = useState('');
  const [dataEntrada, setDataEntrada] = useState('');
  const [codGemco, setCodGemco] = useState('');
  const [descProd, setDescProd] = useState('');
  const [valPecas, setValPecas] = useState(0);
  const [valAcess, setValAcess] = useState(0);
  const [valMaoObra, setValMaoObra] = useState(0);
  const [valEmb, setValEmb] = useState(0);
  const [valHig, setValHig] = useState(0);
  const [itens, setItens] = useState<Item[]>([]);

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 14) return value;
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  };

  useEffect(() => {
    const now = new Date();
    const prot = `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
    setProtocolo(prot);
    setDataEntrada(now.toISOString().slice(0, 10));

    const profileRaw = localStorage.getItem('gat_user_profile');
    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw) as {
          cnpj?: string;
          razao_social?: string;
          email?: string;
        };
        if (profile.cnpj) setCnpj(profile.cnpj);
        if (profile.razao_social) setRazaoSocial(profile.razao_social);
        if (profile.email) setEmail(profile.email);
      } catch {
        // ignore malformed profile
      }
    }

    const loadUserInfo = async () => {
      try {
        const usuario = (localStorage.getItem('gat_user') || '').toLowerCase();
        const res = await oracleApi.get(ORACLE_ENDPOINTS.betUserInf, {
          responseType: 'arraybuffer'
        });
        const data = parseMaybeJson(res.data);
        const list: any[] = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
            ? data
            : [];

        const item =
          list.find((row) => (row?.usuario || row?.USUARIO || '').toLowerCase() === usuario) ??
          list[0] ??
          data ??
          {};

        const fetchedCnpj = item.cnpj ?? item.CNPJ ?? '';
        const fetchedRazao = item.razao_social ?? item.RAZAO_SOCIAL ?? '';
        const fetchedEmail = item.email ?? item.EMAIL ?? '';

        if (fetchedCnpj) setCnpj(fetchedCnpj);
        if (fetchedRazao) setRazaoSocial(fetchedRazao);
        if (fetchedEmail) setEmail(fetchedEmail);
      } catch {
        // silencioso: mantém valores locais
      }
    };

    loadUserInfo();
  }, []);

  const total = useMemo(() => valPecas + valAcess + valMaoObra + valEmb + valHig, [valPecas, valAcess, valMaoObra, valEmb, valHig]);

  const adicionarItem = () => {
    if (!nfRemessa || !codGemco || !descProd) return;
    const item: Item = {
      id: crypto.randomUUID(),
      nf: nfRemessa,
      data: dataEntrada,
      codGemco,
      descricao: descProd,
      total
    };
    setItens((prev) => [...prev, item]);
    setCodGemco('');
    setDescProd('');
  };

  const totalFormatado = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div id="viewNovoOrcamento" className="view-section">
      <h2 className="page-title">Novo Orçamento</h2>

      <div className="card">
        <div className="grid-form">
          <div className="span-2"><label>Protocolo</label><input type="text" value={protocolo} readOnly /></div>
          <div className="span-3"><label>P.A.</label><input type="text" value={localStorage.getItem('gat_user') || ''} readOnly /></div>
          <div className="span-2"><label>CNPJ</label><input type="text" value={formatCnpj(cnpj)} readOnly /></div>
          <div className="span-2"><label>Razão Social</label><input type="text" value={razaoSocial} readOnly /></div>
          <div className="span-3"><label>Email Retorno</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Dados do Produto</div>
        <div className="grid-form">
          <div className="span-2"><label>NF Remessa</label><input type="text" value={nfRemessa} onChange={(e) => setNfRemessa(e.target.value)} /></div>
          <div className="span-2"><label>Data NF</label><input type="date" value={dataEntrada} onChange={(e) => setDataEntrada(e.target.value)} /></div>
          <div className="span-2"><label>Código</label><input type="text" value={codGemco} onChange={(e) => setCodGemco(e.target.value)} /></div>
          <div className="span-6"><label>Descrição</label><input type="text" value={descProd} onChange={(e) => setDescProd(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Valores</div>
        <div className="grid-form">
          <div className="span-3"><label>Valor Peças</label><input type="number" value={valPecas} onChange={(e) => setValPecas(Number(e.target.value))} /></div>
          <div className="span-3"><label>Valor Acessórios</label><input type="number" value={valAcess} onChange={(e) => setValAcess(Number(e.target.value))} /></div>
          <div className="span-2"><label>Mão de Obra</label><input type="number" value={valMaoObra} onChange={(e) => setValMaoObra(Number(e.target.value))} /></div>
          <div className="span-2"><label>Embalagem</label><input type="number" value={valEmb} onChange={(e) => setValEmb(Number(e.target.value))} /></div>
          <div className="span-2"><label>Higienização</label><input type="number" value={valHig} onChange={(e) => setValHig(Number(e.target.value))} /></div>
          <div className="span-6"><label>Total do Orçamento</label><input type="text" readOnly value={totalFormatado(total)} className="total-display" /></div>
        </div>
        <div className="action-bar">
          <button className="btn btn-secondary btn-sm" onClick={adicionarItem}>
            <i className="material-icons">save_as</i> ADICIONAR ITEM
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Itens neste Protocolo</div>
        <div className="table-scroll">
          <table className="tabela-horizontal">
            <thead>
              <tr>
                <th>NF Remessa</th>
                <th>Data NF</th>
                <th>Cód. GEMCO</th>
                <th>Descrição</th>
                <th>Total Orçamento</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#999' }}>Nenhum item adicionado.</td>
                </tr>
              )}
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>{item.nf}</td>
                  <td>{item.data}</td>
                  <td><strong>{item.codGemco}</strong></td>
                  <td>{item.descricao}</td>
                  <td style={{ fontWeight: 'bold', background: '#fff3cd' }}>{totalFormatado(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="action-bar" style={{ marginTop: 20 }}>
          <button className="btn btn-success btn-sm" type="button">
            <i className="material-icons">send</i> FINALIZAR ENVIO
          </button>
        </div>
      </div>
    </div>
  );
};

export default NovoOrcamento;



