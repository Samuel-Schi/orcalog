import { useEffect, useMemo, useState } from 'react';

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
  const [unidade, setUnidade] = useState('');
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

  useEffect(() => {
    const now = new Date();
    const prot = `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
    setProtocolo(prot);
    setDataEntrada(now.toISOString().slice(0, 10));
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
          <div className="span-3"><label>P.A.</label><input type="text" value={localStorage.getItem('ravenna_user') || ''} readOnly /></div>
          <div className="span-2"><label>CNPJ</label><input type="text" value="00.000.000/0000-00" readOnly /></div>
          <div className="span-2"><label>Unidade</label><input type="text" value={unidade} onChange={(e) => setUnidade(e.target.value)} /></div>
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
