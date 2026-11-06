import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { compactLookupValue, ErroImportacao, validarArquivoExcel } from '../lib/importacaoProdutos';
import {
  baixarModeloOrcamento,
  consultarProdutosOrcamento,
  itemBloqueado,
  lerPlanilhaOrcamento,
  marcarSeriaisJaEnviados,
  montarItemCadastro,
  montarValoresOrcamento,
  type ErroLinhaOrcamento,
  type ItemJaEnviado,
  type ItemOrcamentoPlanilha,
  type Pendencia
} from '../lib/importacaoOrcamento';
import { indexarCatalogoApi, padronizarPeca, type CatalogoPadrao } from '../lib/pecaPadrao';

// Itens por chamada de sync: cada item e uma RPC no servidor, e a Function tem limite de tempo.
const ITENS_POR_ENVIO = 5;
const UNIDADES = [49, 93, 299, 389, 549, 893, 985, 1116, 2099, 2599, 2999, 5299, 5599];

const gerarProtocolo = () => {
  const now = new Date();
  return `P${now.getDate()}${now.getMonth() + 1}-${Math.floor(Math.random() * 9000) + 1000}`;
};

const formatCnpj = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14) return value;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const mensagemErro = (error: unknown) => {
  const data = (error as { response?: { data?: { error?: unknown; message?: unknown } } })?.response?.data;
  const detalhe = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : '';
  return detalhe || (error instanceof Error ? error.message : '') || 'Falha inesperada.';
};

type CampoTabela = Pendencia['campo'];

// Padroniza o nome de cada peca pelo catalogo canonico, escopado pela linha do produto (vinda do gemco).
// `padronizada` reescreve para o nome canonico (vai assim para o relatorio/payload); os demais casos viram
// aviso nao-bloqueante, sem reescrever calado (e dinheiro).
const aplicarPadraoPecas = (itens: ItemOrcamentoPlanilha[], catalogo: CatalogoPadrao) => {
  for (const item of itens) {
    const linhaProduto = item.produto?.linha;
    for (const peca of item.pecas) {
      const r = padronizarPeca(peca.nome, catalogo, linhaProduto);
      if (r.status === 'padronizada' && r.canonico) {
        peca.nome = r.canonico;
        if (r.linhaOk === false) {
          item.pendencias.push({
            campo: 'valores',
            mensagem: `Peça "${r.canonico}" não consta na linha ${linhaProduto || '—'} do catálogo. Confira a linha do produto.`,
            bloqueia: false
          });
        }
      } else if (r.status === 'revisar') {
        item.pendencias.push({
          campo: 'valores',
          mensagem: `Peça "${r.original}" parece "${r.sugestao}". Ajuste o nome na planilha para padronizar.`,
          bloqueia: false
        });
      } else {
        item.pendencias.push({
          campo: 'valores',
          mensagem: `Peça "${r.original}" não está no catálogo padrão (ficará sem padronização).`,
          bloqueia: false
        });
      }
    }
  }
};

const ImportarOrcamento = () => {
  const navigate = useNavigate();
  const [protocolo, setProtocolo] = useState(gerarProtocolo);
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [email, setEmail] = useState('');
  const [unidade, setUnidade] = useState('');
  const [arquivo, setArquivo] = useState('');
  const [lendo, setLendo] = useState(false);
  const [progressoLeitura, setProgressoLeitura] = useState({ processados: 0, total: 0 });
  const [erroArquivo, setErroArquivo] = useState('');
  const [itens, setItens] = useState<ItemOrcamentoPlanilha[]>([]);
  const [errosLinha, setErrosLinha] = useState<ErroLinhaOrcamento[]>([]);
  const [soPendencias, setSoPendencias] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [etapaEnvio, setEtapaEnvio] = useState('');
  const [erroEnvio, setErroEnvio] = useState('');
  const [concluido, setConcluido] = useState<{ protocolo: string; salvos: number; comFoto: number } | null>(null);
  const [catalogoPadrao, setCatalogoPadrao] = useState<CatalogoPadrao | null>(null);
  const arquivoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const profile = JSON.parse(localStorage.getItem('gat_user_profile') || 'null') as
        { cnpj?: string; razao_social?: string; email?: string; unidade?: string } | null;
      if (profile?.cnpj) setCnpj(String(profile.cnpj));
      if (profile?.razao_social) setRazaoSocial(String(profile.razao_social));
      if (profile?.email) setEmail(String(profile.email));
      if (profile?.unidade) setUnidade(String(profile.unidade));
      if (profile?.cnpj) return;
    } catch {
      // ignore profile parsing
    }

    const usuario = (localStorage.getItem('gat_user') || '').toLowerCase();
    if (!usuario) return;
    oracleApi.get(ORACLE_ENDPOINTS.getUserInf, {
      params: { usuario, _ts: Date.now() },
      responseType: 'arraybuffer',
      validateStatus: (status) => status >= 200 && status < 400
    }).then((res) => {
      if (cancelled) return;
      const data = parseMaybeJson(res.data);
      const info = (Array.isArray(data?.items) ? data.items[0] : Array.isArray(data) ? data[0] : data) ?? {};
      if (info.cnpj) setCnpj(String(info.cnpj));
      if (info.razao_social) setRazaoSocial(String(info.razao_social));
      if (info.email) setEmail((atual) => atual || String(info.email));
      if (info.unidade) setUnidade((atual) => atual || String(info.unidade));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Catalogo canonico de peca (item_padrao/alias/linha). Carregado uma vez e indexado em Map.
  useEffect(() => {
    let cancelled = false;
    oracleApi.get(ORACLE_ENDPOINTS.getItemPadrao)
      .then((res) => { if (!cancelled) setCatalogoPadrao(indexarCatalogoApi(res.data)); })
      .catch(() => { if (!cancelled) setCatalogoPadrao(null); });
    return () => { cancelled = true; };
  }, []);

  // get_produto_cadastro casa o valor com o Gemco (item) OU com o EAN (codigo_barra).
  const consultarCadastroProduto = async ({ item }: { item: string }) => {
    const res = await oracleApi.get(ORACLE_ENDPOINTS.getProdutoCadastro, {
      params: { item, codigo_barra: item, _ts: Date.now() },
      responseType: 'arraybuffer',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      validateStatus: (status) => status >= 200 && status < 400
    });
    return parseMaybeJson(res.data);
  };

  // Todos os itens do posto (rascunhos, montagem e enviados) para conferir seriais ja enviados.
  const buscarItensDoPosto = async (cnpjDigitos: string): Promise<ItemJaEnviado[]> => {
    try {
      const res = await oracleApi.get(ORACLE_ENDPOINTS.getOrcamentosAnalise, {
        params: { cnpj: cnpjDigitos, _ts: Date.now() },
        responseType: 'arraybuffer',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        timeout: 30000
      });
      const data = parseMaybeJson(res.data);
      if (!Array.isArray(data)) throw new Error('Resposta inválida.');
      return data;
    } catch {
      throw new ErroImportacao('Não foi possível conferir os lotes já enviados para evitar duplicidade. Tente novamente.');
    }
  };

  const lerArquivo = async (selecionado: File) => {
    if (lendo || enviando) return;
    setArquivo(selecionado.name);
    setErroArquivo('');
    setErroEnvio('');
    setConcluido(null);
    setItens([]);
    setErrosLinha([]);
    // Planilha nova = lote novo; reenviar a mesma planilha usa "Tentar novamente".
    const novoProtocolo = gerarProtocolo();
    setProtocolo(novoProtocolo);
    setProgressoLeitura({ processados: 0, total: 0 });
    setLendo(true);
    try {
      validarArquivoExcel(selecionado);
      const cnpjDigitos = cnpj.replace(/\D/g, '');
      if (cnpjDigitos.length !== 14) throw new ErroImportacao('Não foi possível identificar o posto. Saia e entre novamente.');
      const lido = await lerPlanilhaOrcamento(await selecionado.arrayBuffer());
      await consultarProdutosOrcamento(lido.itens, consultarCadastroProduto, (processados, total) =>
        setProgressoLeitura({ processados, total }));
      // Padroniza o nome das pecas pela linha do produto (so quando o catalogo ja carregou).
      if (catalogoPadrao) aplicarPadraoPecas(lido.itens, catalogoPadrao);
      marcarSeriaisJaEnviados(lido.itens, await buscarItensDoPosto(cnpjDigitos), novoProtocolo);
      setItens([...lido.itens]);
      setErrosLinha(lido.errosLinha);
    } catch (error) {
      setErroArquivo(error instanceof ErroImportacao ? error.message : 'Não foi possível processar o arquivo. Tente novamente.');
    } finally {
      setLendo(false);
      if (arquivoInputRef.current) arquivoInputRef.current.value = '';
    }
  };

  const resumo = useMemo(() => {
    const bloqueados = itens.filter(itemBloqueado).length;
    const comAviso = itens.filter((item) => !itemBloqueado(item) && item.pendencias.length > 0).length;
    const duplicados = itens.filter((item) => item.loteAnterior !== undefined);
    return {
      bloqueados,
      comAviso,
      duplicados: duplicados.length,
      lotesAnteriores: Array.from(new Set(duplicados.map((item) => item.loteAnterior || 'sem protocolo'))),
      prontos: itens.length - bloqueados,
      total: itens.reduce((soma, item) => soma + item.total, 0)
    };
  }, [itens]);

  const podeEnviar = itens.length > 0 && resumo.bloqueados === 0 && errosLinha.length === 0 && !lendo && !enviando && !concluido;

  const enviarLote = async () => {
    if (!podeEnviar) return;
    const cnpjDigitos = cnpj.replace(/\D/g, '');
    const paUsuario = (localStorage.getItem('gat_user') || '').trim();
    if (cnpjDigitos.length !== 14 || !paUsuario) {
      setErroEnvio('Não foi possível identificar o posto. Saia e entre novamente.');
      return;
    }
    if (!email.trim() || !unidade.trim()) {
      setErroEnvio('Preencha o e-mail de retorno e a unidade antes de enviar.');
      return;
    }

    setEnviando(true);
    setErroEnvio('');
    const base = { protocolo, paUsuario, cnpj: cnpjDigitos, razaoSocial, unidade, emailRetorno: email };
    const cadastros = new Map(itens.map((item) => [item, montarItemCadastro(item, protocolo)]));
    try {
      // Confere de novo na hora do envio: a mesma planilha pode ter sido enviada em outra aba.
      setEtapaEnvio('Conferindo envios anteriores...');
      const jaEnviados = marcarSeriaisJaEnviados(itens, await buscarItensDoPosto(cnpjDigitos), protocolo);
      if (jaEnviados.length) {
        setItens([...itens]);
        setErroEnvio(`Envio cancelado por DUPLICIDADE: ${jaEnviados.length} serial(is) desta planilha já foram enviados em outro lote em aberto (veja as linhas marcadas como "Já enviado"). Nada foi gravado.`);
        return;
      }

      // 1. Cadastra o lote, como em Novo Orcamento. Reenviar os mesmos itens nao duplica.
      setEtapaEnvio('Cadastrando o lote...');
      await oracleApi.post(ORACLE_ENDPOINTS.saveOrcamento, { ...base, itens: Array.from(cadastros.values()) }, {
        headers: { 'Content-Type': 'application/json' }
      });

      // 2. Busca os IDs gerados pelo banco para cada serial.
      setEtapaEnvio('Conferindo os itens cadastrados...');
      const res = await oracleApi.get(ORACLE_ENDPOINTS.getLancamentoDraftsSupabase, {
        params: { paUsuario, _ts: Date.now() },
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
      });
      const idPorSerial = new Map<string, number>();
      (Array.isArray(res.data) ? res.data : []).forEach((row: { oracle_item_id?: unknown; payload?: Record<string, unknown> }) => {
        if (row?.payload?.protocolo !== protocolo) return;
        const id = Number(row.oracle_item_id);
        if (id) idPorSerial.set(compactLookupValue(String(row.payload.serial || '')), id);
      });
      // Itens ausentes ja foram salvos numa tentativa anterior (sairam de RASCUNHO).
      const pendentes = itens
        .map((item) => ({ item, id: idPorSerial.get(compactLookupValue(item.serial)) }))
        .filter((entrada): entrada is { item: ItemOrcamentoPlanilha; id: number } => Boolean(entrada.id));
      const comValores = pendentes.filter(({ item }) => !item.avaria);
      const comFoto = pendentes.filter(({ item }) => item.avaria);

      // 3. Salva os valores, como o botao de Lancar Orcamentos: o item fica em MONTAGEM.
      for (let inicio = 0; inicio < comValores.length; inicio += ITENS_POR_ENVIO) {
        setEtapaEnvio(`Salvando orçamentos: ${inicio} de ${comValores.length}...`);
        const lote = comValores.slice(inicio, inicio + ITENS_POR_ENVIO);
        await oracleApi.post(ORACLE_ENDPOINTS.syncOrcamentoSupabase, {
          ...base,
          itens: lote.map(({ item, id }) => ({
            id,
            itemId: id,
            ...cadastros.get(item),
            ...montarValoresOrcamento(item),
            status: 8
          }))
        }, { headers: { 'Content-Type': 'application/json' } });
      }

      // Avaria precisa de foto: os valores ficam como rascunho em Lancar Orcamentos.
      for (const [indice, { item, id }] of comFoto.entries()) {
        setEtapaEnvio(`Guardando itens com avaria: ${indice} de ${comFoto.length}...`);
        await oracleApi.post(ORACLE_ENDPOINTS.saveLancamentoDraftSupabase, {
          oracleItemId: id,
          protocolo,
          paUsuario,
          cnpj: cnpjDigitos,
          payload: { ...montarValoresOrcamento(item), protocolo, serial: item.serial, status: 0 }
        }, { headers: { 'Content-Type': 'application/json' } });
      }

      setConcluido({ protocolo, salvos: itens.filter((item) => !item.avaria).length, comFoto: itens.filter((item) => item.avaria).length });
    } catch (error) {
      setErroEnvio(`Não foi possível concluir o envio: ${mensagemErro(error)} Clique em "Tentar novamente": os itens já gravados não são duplicados.`);
    } finally {
      setEnviando(false);
      setEtapaEnvio('');
    }
  };

  const pendenciasDe = (item: ItemOrcamentoPlanilha, campo: CampoTabela) =>
    item.pendencias.filter((p) => p.campo === campo && p.bloqueia);

  const celula = (item: ItemOrcamentoPlanilha, campo: CampoTabela, valor: string) => {
    const erro = pendenciasDe(item, campo).length > 0;
    return (
      <td className={erro ? 'importacao-orc-celula-erro' : undefined}>
        {valor || <span className="importacao-orc-vazio">em branco</span>}
      </td>
    );
  };

  const itensVisiveis = soPendencias ? itens.filter((item) => item.pendencias.length > 0) : itens;

  return (
    <div id="viewImportarOrcamento" className="view-section novo-orcamento-page">
      <h2 className="page-title">Importar Orçamento</h2>

      <div className="card">
        <div className="grid-form novo-orcamento-grid">
          <div className="span-2"><label>Protocolo</label><input type="text" value={protocolo} readOnly /></div>
          <div className="span-2"><label>Usuário</label><input type="text" value={localStorage.getItem('gat_user') || ''} readOnly /></div>
          <div className="span-2"><label>CNPJ</label><input type="text" value={formatCnpj(cnpj)} readOnly /></div>
          <div className="span-2"><label>Razão Social</label><input type="text" value={razaoSocial} readOnly /></div>
          <div className="span-4">
            <label>Email Retorno *</label>
            <input type="email" value={email} required placeholder="Obrigatorio preencher" onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="grid-form novo-orcamento-grid" style={{ marginTop: 10 }}>
          <div className="span-4">
            <label>Unidade *</label>
            <select value={unidade} required onChange={(e) => setUnidade(e.target.value)}>
              <option value="">Selecione a unidade</option>
              {UNIDADES.map((codigo) => <option key={codigo} value={String(codigo)}>DQS - {codigo}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Planilha do orçamento</div>
        <div className="novo-orcamento-help">
          Baixe o modelo, preencha <strong>uma linha por produto</strong> e envie a planilha.
          Peças e acessórios vão numa célula só, no formato <strong>Display: 300; Flex: 50</strong>.
          Antes de enviar, a tabela abaixo mostra cada produto com o que ficou em branco ou inválido.
          Depois do envio, o lote aparece em <strong>Meus Envios</strong> para você finalizar e mandar para aprovação.
        </div>
        <div className="novo-orcamento-importacao-acoes">
          <input
            ref={arquivoInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            hidden
            onChange={(e) => {
              const selecionado = e.target.files?.[0];
              if (selecionado) void lerArquivo(selecionado);
            }}
          />
          <button className="btn btn-secondary btn-sm" type="button" disabled={lendo || enviando} onClick={() => {
            baixarModeloOrcamento().catch(() => setErroArquivo('Não foi possível gerar o modelo. Tente novamente.'));
          }}>
            <i className="material-icons">download</i> Baixar modelo
          </button>
          <button className="btn btn-primary btn-sm" type="button" disabled={lendo || enviando} onClick={() => arquivoInputRef.current?.click()}>
            <i className="material-icons">upload_file</i> {lendo ? 'Lendo...' : 'Selecionar planilha'}
          </button>
          {arquivo && <span className="novo-orcamento-arquivo">{arquivo}</span>}
        </div>

        {lendo && (
          <div className="novo-orcamento-progresso" role="status" aria-live="polite">
            <progress value={progressoLeitura.processados} max={Math.max(progressoLeitura.total, 1)} />
            <span>
              {progressoLeitura.total
                ? `Consultando produtos: ${progressoLeitura.processados} de ${progressoLeitura.total}`
                : 'Lendo planilha...'}
            </span>
          </div>
        )}

        {erroArquivo && <div className="novo-orcamento-alerta erro" role="alert">{erroArquivo}</div>}
      </div>

      {(itens.length > 0 || errosLinha.length > 0) && (
        <div className="card">
          <div className="section-title">Conferência antes do envio</div>
          <div className="novo-orcamento-resultado-resumo">
            <span className="item-count-badge importado">{resumo.prontos} pronto(s)</span>
            <span className="item-count-badge atualizado">{resumo.comAviso} com aviso</span>
            <span className="item-count-badge erro">{resumo.bloqueados + errosLinha.length} com pendência</span>
            <span className="importacao-orc-total">Total do lote: <strong>{formatCurrency(resumo.total)}</strong></span>
            <label className="importacao-orc-filtro">
              <input type="checkbox" checked={soPendencias} onChange={(e) => setSoPendencias(e.target.checked)} />
              Mostrar só itens com pendência ou aviso
            </label>
          </div>

          {resumo.duplicados > 0 && (
            <div className="novo-orcamento-alerta erro importacao-orc-lista" role="alert">
              <strong>Duplicidade: {resumo.duplicados} produto(s) desta planilha já foram enviados.</strong>
              <div>
                Esses seriais já estão no(s) lote(s) {resumo.lotesAnteriores.join(', ')}, que ainda estão em aberto.
                Para o mesmo produto não ficar em dois lotes, eles não podem ser enviados de novo.
                Remova essas linhas da planilha (marcadas como <strong>Já enviado</strong>) e envie o arquivo outra vez,
                ou cancele o item no lote anterior em Meus Envios.
              </div>
            </div>
          )}

          {errosLinha.length > 0 && (
            <div className="novo-orcamento-alerta erro importacao-orc-lista" role="alert">
              {errosLinha.map((erro) => <div key={erro.linha}>Linha {erro.linha}: {erro.mensagem}</div>)}
            </div>
          )}

          <div className="table-scroll novo-orcamento-resultado-tabela importacao-orc-scroll">
            <table className="tabela-horizontal importacao-orc-tabela">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Serial</th>
                  <th>Nota fiscal</th>
                  <th>Gemco / EAN</th>
                  <th>Produto</th>
                  <th>Defeito encontrado</th>
                  <th>Def. funcional</th>
                  <th>Garantia</th>
                  <th>Tipo Orc.</th>
                  <th>Peças e valores</th>
                  <th>Total</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {itensVisiveis.map((item) => {
                  const bloqueado = itemBloqueado(item);
                  const valores = [
                    ...item.pecas.map((p) => `${p.nome}: ${formatCurrency(p.valor)}`),
                    ...item.acessorios.map((a) => `${a.nome} (acessório): ${formatCurrency(a.valor)}`),
                    ...(item.valMaoObra ? [`Mão de obra: ${formatCurrency(item.valMaoObra)}`] : []),
                    ...(item.valEmb ? [`Embalagem: ${formatCurrency(item.valEmb)}`] : []),
                    ...(item.valHig ? [`Higienização: ${formatCurrency(item.valHig)}`] : [])
                  ];
                  return (
                    <tr key={item.serial} className={bloqueado ? 'resultado-erro' : item.pendencias.length ? 'resultado-atualizado' : 'resultado-importado'}>
                      <td>{item.linha}</td>
                      {celula(item, 'serial', item.serial)}
                      {celula(item, 'notaFiscal', item.notaFiscal)}
                      {celula(item, 'codigo', item.codigo)}
                      <td className={pendenciasDe(item, 'codigo').length ? 'importacao-orc-celula-erro' : undefined}>{item.produto?.descricao || '-'}</td>
                      {celula(item, 'defeitoEncontrado', item.defeitoEncontrado)}
                      {celula(item, 'defeitoFuncional', item.defeitoFuncional)}
                      {celula(item, 'garantia', item.garantia)}
                      {celula(item, 'tipoOrc', item.tipoOrc)}
                      <td className={pendenciasDe(item, 'valores').length ? 'importacao-orc-celula-erro' : undefined}>
                        {valores.length ? valores.map((v) => <div key={v}>{v}</div>) : <span className="importacao-orc-vazio">sem valores</span>}
                      </td>
                      <td>{formatCurrency(item.total)}</td>
                      <td>
                        <strong>
                          {item.loteAnterior !== undefined
                            ? `Já enviado (lote ${item.loteAnterior || 'sem protocolo'})`
                            : bloqueado ? 'Pendente' : item.pendencias.length ? 'Pronto, com aviso' : 'Pronto'}
                        </strong>
                        {item.pendencias.map((p) => (
                          <div key={p.mensagem} className={p.bloqueia ? 'importacao-orc-msg-erro' : 'importacao-orc-msg-aviso'}>{p.mensagem}</div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {erroEnvio && <div className="novo-orcamento-alerta erro" role="alert">{erroEnvio}</div>}
          {enviando && <div className="novo-orcamento-progresso" role="status" aria-live="polite"><span>{etapaEnvio}</span></div>}

          {concluido ? (
            <div className="novo-orcamento-alerta sucesso importacao-orc-lista" role="status">
              <div>
                Lote <strong>{concluido.protocolo}</strong> criado com {concluido.salvos} orçamento(s) salvo(s).
                {concluido.comFoto > 0 && ` ${concluido.comFoto} item(ns) com avaria aguardam a foto em Lançar Orçamentos.`}
                {' '}Finalize o lote em Meus Envios para mandar para aprovação.
              </div>
              <div>
                <button className="btn btn-success btn-sm" type="button" onClick={() => navigate('/meus-envios')}>
                  <i className="material-icons">list_alt</i> Ir para Meus Envios
                </button>
              </div>
            </div>
          ) : (
            <div className="importacao-orc-acoes">
              {!podeEnviar && !lendo && !enviando && (
                <span className="importacao-orc-dica">
                  {resumo.duplicados > 0
                    ? 'Envio bloqueado por duplicidade: remova os seriais já enviados e envie o arquivo de novo.'
                    : 'Corrija as pendências na planilha e envie o arquivo de novo.'}
                </span>
              )}
              <button className="btn btn-success novo-orcamento-finalizar" type="button" disabled={!podeEnviar} onClick={() => void enviarLote()}>
                {enviando ? 'Enviando...' : erroEnvio ? 'Tentar novamente' : `Enviar lote (${itens.length} produto${itens.length === 1 ? '' : 's'})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImportarOrcamento;
