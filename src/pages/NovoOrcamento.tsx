import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { compactLookupValue, ErroImportacao, extrairProdutoApi, formatSerialValue, type ProdutoApi } from '../lib/importacaoProdutos';
import {
  baixarIdentificadoresGerados,
  consultarProdutosOrcamento,
  definirEvidencias,
  serialExibido,
  inconsistenciasDoLote,
  interpretarItemManual,
  itemBloqueado,
  rotuloCampo,
  TIPOS_ORC,
  type ItemOrcamentoPlanilha,
  type Pendencia
} from '../lib/importacaoOrcamento';
import { indexarCatalogoApi, normalizarNome, type CatalogoPadrao } from '../lib/pecaPadrao';
import PadronizacaoPecas from '../components/PadronizacaoPecas';
import {
  alternarPadronizacao,
  aplicarPadraoPecas,
  consultarCadastroProduto,
  enviarLoteOrcamento,
  gruposPadronizados,
  gruposSemPadrao,
  registrarPedidosPadraoNovo,
  formatCnpj,
  formatCurrency,
  gerarProtocolo,
  mensagemErro,
  UNIDADES
} from '../lib/envioOrcamento';
import { estiloImportar } from './ImportarOrcamento';
import EvidenciasItem from '../components/EvidenciasItem';

/*
 * Lancamento manual (opcional): um produto por vez, com os MESMOS campos e regras
 * da planilha de Importar Orcamento (serial, nota fiscal, Gemco/EAN, defeitos, pecas e valores).
 * Sem UUID: o item e identificado por serial + nota fiscal, como no Excel.
 */

type LinhaValor = { nome: string; valor: string };

type Formulario = {
  serial: string;
  notaFiscal: string;
  codigo: string;
  defeitoEncontrado: string;
  defeitoFuncional: string;
  garantia: string;
  avariaEstetica: string;
  tipoOrc: string;
  pecas: LinhaValor[];
  acessorios: LinhaValor[];
  maoObra: string;
  embalagem: string;
  higienizacao: string;
};

type Consulta = {
  status: 'idle' | 'carregando' | 'encontrado' | 'nao_encontrado' | 'erro';
  codigo: string;
  produto: ProdutoApi | null;
};

const linhaVazia = (): LinhaValor => ({ nome: '', valor: '' });

const formularioVazio = (): Formulario => ({
  serial: '',
  notaFiscal: '',
  codigo: '',
  defeitoEncontrado: '',
  defeitoFuncional: '',
  garantia: '',
  avariaEstetica: '',
  tipoOrc: '',
  pecas: [linhaVazia()],
  acessorios: [linhaVazia()],
  maoObra: '',
  embalagem: '',
  higienizacao: ''
});

// Mesmo texto da celula do Excel: "Display: 300; Flex: 50".
const juntarItens = (linhas: LinhaValor[]) =>
  linhas
    .filter((l) => l.nome.trim() || l.valor.trim())
    .map((l) => `${l.nome.trim()}: ${l.valor.trim()}`)
    .join('; ');

// Volta um item da lista para o formulario (editar).
const formularioDoItem = (item: ItemOrcamentoPlanilha): Formulario => {
  const linhas = (lista: { nome: string; valor: number }[]) =>
    lista.length ? lista.map((l) => ({ nome: l.nome, valor: String(l.valor).replace('.', ',') })) : [linhaVazia()];
  const valor = (v: number) => (v ? String(v).replace('.', ',') : '');
  return {
    serial: item.serial,
    notaFiscal: item.notaFiscal,
    codigo: item.codigo,
    defeitoEncontrado: item.defeitoEncontrado,
    defeitoFuncional: item.defeitoFuncional,
    garantia: item.garantia,
    avariaEstetica: item.avariaEstetica || '',
    tipoOrc: item.tipoOrc,
    pecas: linhas(item.pecas),
    acessorios: linhas(item.acessorios),
    maoObra: valor(item.valMaoObra),
    embalagem: valor(item.valEmb),
    higienizacao: valor(item.valHig)
  };
};

const draftKey = (paUsuario: string) => `orcamento_manual_rascunho:${paUsuario}`;

const estiloManual = `
.man-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
.man-grid .c3 { grid-column: span 3; } .man-grid .c4 { grid-column: span 4; } .man-grid .c6 { grid-column: span 6; } .man-grid .c12 { grid-column: span 12; }
.man-sub { margin: 18px 0 10px; font-size: .82rem; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--imp-muted); }
.man-produto { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: .8rem; color: var(--imp-muted); min-height: 18px; }
.man-produto.ok { color: #1e5e2f; } .man-produto.erro { color: #8a1c24; }
.man-produto .material-icons { font-size: 16px; }
.man-linhas { display: flex; flex-direction: column; gap: 8px; }
.man-linha { display: grid; grid-template-columns: minmax(0, 1fr) 140px 36px; gap: 8px; align-items: center; }
.man-linha input { height: 38px; border-radius: 8px; padding: 0 12px; font-size: .9rem; }
.man-icone { width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--imp-borda); background: #fff; color: #b42318; cursor: pointer; }
.man-icone:disabled { opacity: .4; cursor: not-allowed; }
.man-icone .material-icons { font-size: 18px; }
.man-mais { align-self: flex-start; margin-top: 2px; }
.man-acoes { display: flex; align-items: center; justify-content: flex-end; gap: 12px; flex-wrap: wrap; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--imp-borda); }
.man-total { margin-right: auto; font-size: .88rem; color: var(--imp-muted); }
.man-total strong { color: var(--imp-texto); font-size: 1rem; margin-left: 4px; }
.man-btn-primary { background: var(--imp-azul); color: #fff; }
.man-btn-primary:hover:not(:disabled) { filter: brightness(.95); }
.man-pend { margin-top: 12px; }
.man-pend ul { margin: 6px 0 0; padding-left: 18px; }
.man-tabela-acoes { white-space: nowrap; display: flex; gap: 6px; }
.man-tabela-acoes .man-icone.editar { color: var(--imp-azul); }
@media (max-width: 900px) { .man-grid .c3, .man-grid .c4 { grid-column: span 6; } }
@media (max-width: 640px) {
  .man-grid .c3, .man-grid .c4, .man-grid .c6 { grid-column: span 12; }
  .man-linha { grid-template-columns: minmax(0, 1fr) 100px 36px; }
}
`;

const NovoOrcamento = () => {
  const navigate = useNavigate();
  const paUsuario = (localStorage.getItem('gat_user') || '').trim();
  const [protocolo, setProtocolo] = useState(gerarProtocolo);
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [email, setEmail] = useState('');
  const [unidade, setUnidade] = useState('');
  const [form, setForm] = useState<Formulario>(formularioVazio);
  const [consulta, setConsulta] = useState<Consulta>({ status: 'idle', codigo: '', produto: null });
  const [itens, setItens] = useState<ItemOrcamentoPlanilha[]>([]);
  const [pendenciasForm, setPendenciasForm] = useState<string[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [catalogoPadrao, setCatalogoPadrao] = useState<CatalogoPadrao | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [etapaEnvio, setEtapaEnvio] = useState('');
  const [erroEnvio, setErroEnvio] = useState('');
  const [concluido, setConcluido] = useState<{ protocolo: string; salvos: number; comFoto: number; fotosNaoEnviadas: number; erroDrive: string } | null>(null);
  // Evidencias do item que voltou para o formulario em "Editar": reaplicadas ao adicionar de novo.
  const [evidenciasEdicao, setEvidenciasEdicao] = useState<File[]>([]);
  const [avisoPadrao, setAvisoPadrao] = useState('');
  const draftCarregadoRef = useRef(false);
  const consultaSeqRef = useRef(0);
  const serialRef = useRef<HTMLInputElement | null>(null);

  // Rascunho so no navegador (nao gera requisicao no Supabase).
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(draftKey(paUsuario)) || 'null');
      if (salvo && typeof salvo === 'object') {
        if (salvo.protocolo) setProtocolo(String(salvo.protocolo));
        // Fotos e videos nao cabem no rascunho do navegador: voltam sem evidencia (avaria volta a avisar).
        if (Array.isArray(salvo.itens)) setItens(salvo.itens.map((item: ItemOrcamentoPlanilha) => definirEvidencias(item, [])));
        if (salvo.form && typeof salvo.form === 'object') setForm({ ...formularioVazio(), ...salvo.form });
        if (salvo.email) setEmail(String(salvo.email));
        if (salvo.unidade) setUnidade(String(salvo.unidade));
      }
    } catch {
      // rascunho invalido: comeca do zero
    }
    draftCarregadoRef.current = true;
  }, [paUsuario]);

  useEffect(() => {
    if (!draftCarregadoRef.current || !paUsuario || concluido) return;
    const handle = window.setTimeout(() => {
      try {
        const semArquivos = itens.map(({ evidencias: _evidencias, ...item }) => item);
        localStorage.setItem(draftKey(paUsuario), JSON.stringify({ protocolo, itens: semArquivos, form, email, unidade }));
      } catch {
        // silencioso: a tela continua funcionando sem rascunho
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [paUsuario, protocolo, itens, form, email, unidade, concluido]);

  useEffect(() => {
    let cancelled = false;
    try {
      const profile = JSON.parse(localStorage.getItem('gat_user_profile') || 'null') as
        { cnpj?: string; razao_social?: string; email?: string; unidade?: string } | null;
      if (profile?.cnpj) setCnpj(String(profile.cnpj));
      if (profile?.razao_social) setRazaoSocial(String(profile.razao_social));
      if (profile?.email) setEmail((atual) => atual || String(profile.email));
      if (profile?.unidade) setUnidade((atual) => atual || String(profile.unidade));
      if (profile?.cnpj) return;
    } catch {
      // ignore profile parsing
    }

    const usuario = paUsuario.toLowerCase();
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
  }, [paUsuario]);

  useEffect(() => {
    let cancelled = false;
    oracleApi.get(ORACLE_ENDPOINTS.getItemPadrao)
      .then((res) => { if (!cancelled) setCatalogoPadrao(indexarCatalogoApi(res.data)); })
      .catch(() => { if (!cancelled) setCatalogoPadrao(null); });
    return () => { cancelled = true; };
  }, []);

  const set = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const consultarProduto = async (valor: string) => {
    const codigo = compactLookupValue(valor);
    if (!codigo) {
      consultaSeqRef.current += 1;
      setConsulta({ status: 'idle', codigo: '', produto: null });
      return;
    }
    if (consulta.codigo === codigo && consulta.status !== 'erro') return;
    const seq = ++consultaSeqRef.current;
    setConsulta({ status: 'carregando', codigo, produto: null });
    try {
      const produto = extrairProdutoApi(await consultarCadastroProduto({ item: codigo }));
      if (seq !== consultaSeqRef.current) return;
      setConsulta(produto.descricao
        ? { status: 'encontrado', codigo, produto }
        : { status: 'nao_encontrado', codigo, produto: null });
    } catch {
      if (seq === consultaSeqRef.current) setConsulta({ status: 'erro', codigo, produto: null });
    }
  };

  // Sugestoes de peca do catalogo padrao, priorizando as da linha do produto.
  const sugestoesPeca = useMemo(() => {
    if (!catalogoPadrao) return [];
    const linha = normalizarNome(consulta.produto?.linha);
    const pecas = catalogoPadrao.lista.filter((p) => p.tipo === 'PECA');
    const daLinha = linha ? pecas.filter((p) => catalogoPadrao.linhasPorCodigo.get(p.codigo)?.has(linha)) : [];
    return Array.from(new Set((daLinha.length ? daLinha : pecas).map((p) => p.nomeCanonico))).sort();
  }, [catalogoPadrao, consulta.produto?.linha]);

  const totalForm = useMemo(() => {
    const { item } = interpretarItemManual({
      serial: 'X',
      pecas: juntarItens(form.pecas),
      acessorios: juntarItens(form.acessorios),
      maoObra: form.maoObra,
      embalagem: form.embalagem,
      higienizacao: form.higienizacao
    });
    return item?.total ?? 0;
  }, [form.pecas, form.acessorios, form.maoObra, form.embalagem, form.higienizacao]);

  const adicionarItem = async () => {
    if (adicionando || enviando || concluido) return;
    setPendenciasForm([]);
    const { item, erro } = interpretarItemManual({
      serial: form.serial,
      notaFiscal: form.notaFiscal,
      codigo: form.codigo,
      defeitoEncontrado: form.defeitoEncontrado,
      defeitoFuncional: form.defeitoFuncional,
      garantia: form.garantia,
      avariaEstetica: form.avariaEstetica,
      tipoOrc: form.tipoOrc,
      pecas: juntarItens(form.pecas),
      acessorios: juntarItens(form.acessorios),
      maoObra: form.maoObra,
      embalagem: form.embalagem,
      higienizacao: form.higienizacao
    }, itens.length + 1);
    if (!item) {
      setPendenciasForm([erro || 'Preencha os dados do produto.']);
      serialRef.current?.focus();
      return;
    }
    const chave = compactLookupValue(item.serial);
    // Sem serial nao conflita: cada peca recebe o proprio identificador no envio.
    if (chave && itens.some((i) => compactLookupValue(i.serial) === chave)) {
      setPendenciasForm([`Serial ${item.serial} já está neste lote. Use um produto por serial.`]);
      serialRef.current?.focus();
      return;
    }

    setAdicionando(true);
    try {
      if (item.codigo && !item.pendencias.some((p) => p.campo === 'codigo')) {
        if (consulta.status === 'encontrado' && consulta.codigo === item.codigo && consulta.produto) item.produto = consulta.produto;
        else await consultarProdutosOrcamento([item], consultarCadastroProduto);
      }
      if (catalogoPadrao) aplicarPadraoPecas([item], catalogoPadrao);

      // Padronizacao da peca nunca impede adicionar (troca automatica ou nome original; ver painel do lote).
      const bloqueios = item.pendencias.filter((p) => p.bloqueia && p.campo !== 'padrao');
      if (bloqueios.length) {
        setPendenciasForm(bloqueios.map((p) => p.mensagem));
        return;
      }
      if (evidenciasEdicao.length) definirEvidencias(item, evidenciasEdicao);
      setEvidenciasEdicao([]);
      setItens((atual) => [...atual, item]);
      setForm(formularioVazio());
      consultaSeqRef.current += 1;
      setConsulta({ status: 'idle', codigo: '', produto: null });
      setErroEnvio('');
      requestAnimationFrame(() => serialRef.current?.focus());
    } finally {
      setAdicionando(false);
    }
  };

  const editarItem = (indice: number) => {
    const item = itens[indice];
    if (!item || enviando) return;
    setForm(formularioDoItem(item));
    setEvidenciasEdicao(item.evidencias || []);
    setConsulta(item.produto
      ? { status: 'encontrado', codigo: item.codigo, produto: item.produto }
      : { status: 'idle', codigo: '', produto: null });
    setItens((atual) => atual.filter((_, i) => i !== indice));
    setPendenciasForm([]);
    requestAnimationFrame(() => serialRef.current?.focus());
  };

  const removerItem = (indice: number) => {
    if (enviando) return;
    setItens((atual) => atual.filter((_, i) => i !== indice));
  };

  // Mesma padronizacao automatica da planilha; a posicao do item no lote faz o papel da linha.
  const itensNumerados = useMemo(() => itens.map((item, i) => ({ ...item, linha: i + 1 })), [itens]);
  const semPadrao = useMemo(() => gruposSemPadrao(itensNumerados), [itensNumerados]);
  const padronizadas = useMemo(() => gruposPadronizados(itensNumerados), [itensNumerados]);
  const alternarPadrao = (chave: string, desfazer: boolean) => setItens((atual) => alternarPadronizacao(atual, chave, desfazer));

  const anexarEvidencias = (indice: number, arquivos: File[]) => {
    setErroEnvio('');
    setItens((atual) => atual.map((item, i) => (i === indice ? { ...definirEvidencias(item, arquivos) } : item)));
  };

  const resumo = useMemo(() => ({
    total: itens.reduce((soma, item) => soma + item.total, 0)
  }), [itens]);
  // Mesma trava da planilha; aqui a "linha" e a posicao do item no lote.
  const inconsistencias = useMemo(() => inconsistenciasDoLote(itens.map((item, i) => ({ ...item, linha: i + 1 }))), [itens]);

  const dadosOk = Boolean(email.trim() && unidade.trim());
  const podeEnviar = itens.length > 0 && inconsistencias.length === 0 && dadosOk && !enviando && !adicionando && !concluido;

  const enviarLote = async () => {
    if (!podeEnviar) return;
    const cnpjDigitos = cnpj.replace(/\D/g, '');
    if (cnpjDigitos.length !== 14 || !paUsuario) {
      setErroEnvio('Não foi possível identificar o posto. Saia e entre novamente.');
      return;
    }
    setEnviando(true);
    setErroEnvio('');
    try {
      const resultado = await enviarLoteOrcamento(
        itens,
        { protocolo, paUsuario, cnpj: cnpjDigitos, razaoSocial, unidade, emailRetorno: email },
        setEtapaEnvio
      );
      setConcluido({ protocolo, salvos: resultado.salvos, comFoto: resultado.comFoto, fotosNaoEnviadas: resultado.fotosNaoEnviadas, erroDrive: resultado.erroDrive });
      try { localStorage.removeItem(draftKey(paUsuario)); } catch { /* ignore */ }
      if (semPadrao.length) {
        const pedidos = await registrarPedidosPadraoNovo(semPadrao, { protocolo, paUsuario, cnpj: cnpjDigitos });
        if (pedidos.falhas) setAvisoPadrao(`Lote enviado, mas ${pedidos.falhas} pedido(s) de padrão novo não foram registrados no catálogo (${pedidos.motivo}).`);
      }
    } catch (error) {
      if (error instanceof ErroImportacao) setErroEnvio(`${error.message} Nada foi gravado.`);
      else setErroEnvio(`Não foi possível concluir o envio: ${mensagemErro(error)} Clique em "Tentar novamente": os itens já gravados não são duplicados.`);
    } finally {
      setEnviando(false);
      setEtapaEnvio('');
    }
  };

  const novoLote = () => {
    setConcluido(null);
    setItens([]);
    setEvidenciasEdicao([]);
    setForm(formularioVazio());
    setConsulta({ status: 'idle', codigo: '', produto: null });
    setPendenciasForm([]);
    setErroEnvio('');
    setProtocolo(gerarProtocolo());
  };

  const enterAdiciona = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void adicionarItem();
  };

  const situacaoItem = (item: ItemOrcamentoPlanilha) => {
    if (itemBloqueado(item)) return { tipo: 'erro', texto: 'Pendente' };
    if (item.pendencias.length) return { tipo: 'aviso', texto: 'Pronto, com aviso' };
    return { tipo: 'ok', texto: 'Pronto' };
  };

  const bloqueado = enviando || Boolean(concluido);

  const editorLinhas = (campo: 'pecas' | 'acessorios', placeholder: string, lista?: string) => (
    <div className="man-linhas">
      {form[campo].map((linha, indice) => (
        <div className="man-linha" key={indice}>
          <input
            type="text"
            value={linha.nome}
            placeholder={placeholder}
            list={lista}
            disabled={bloqueado}
            aria-label={`${campo === 'pecas' ? 'Peça' : 'Acessório'} ${indice + 1}`}
            onChange={(e) => set(campo, form[campo].map((l, i) => (i === indice ? { ...l, nome: e.target.value } : l)))}
          />
          <input
            type="text"
            inputMode="decimal"
            value={linha.valor}
            placeholder="R$ 0,00"
            disabled={bloqueado}
            aria-label={`Valor ${indice + 1}`}
            onChange={(e) => set(campo, form[campo].map((l, i) => (i === indice ? { ...l, valor: e.target.value } : l)))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              set(campo, [...form[campo], linhaVazia()]);
            }}
          />
          <button
            type="button"
            className="man-icone"
            title="Remover"
            disabled={bloqueado || (form[campo].length === 1 && !linha.nome && !linha.valor)}
            onClick={() => set(campo, form[campo].length === 1 ? [linhaVazia()] : form[campo].filter((_, i) => i !== indice))}
          >
            <i className="material-icons">close</i>
          </button>
        </div>
      ))}
      <button type="button" className="imp-btn imp-btn-ghost man-mais" disabled={bloqueado} onClick={() => set(campo, [...form[campo], linhaVazia()])}>
        <i className="material-icons">add</i> {campo === 'pecas' ? 'Adicionar peça' : 'Adicionar acessório'}
      </button>
    </div>
  );

  const campoCelula = (item: ItemOrcamentoPlanilha, campo: Pendencia['campo'], valor: string) => {
    const erro = item.pendencias.some((p) => p.campo === campo && p.bloqueia);
    return (
      <td className={erro ? 'importacao-orc-celula-erro' : undefined}>
        {valor || <span className="importacao-orc-vazio">em branco</span>}
      </td>
    );
  };

  return (
    <div id="viewNovoOrcamento" className="view-section novo-orcamento-page imp-page">
      <style>{estiloImportar}{estiloManual}</style>

      <div className="imp-header">
        <div>
          <h2 className="page-title imp-title">Lançamento manual</h2>
          <p className="imp-subtitle">Opcional: lance os produtos um a um, com os mesmos campos da planilha de importação.</p>
        </div>
        <div className="imp-protocolo" title="Protocolo do lote">
          <i className="material-icons">confirmation_number</i>
          <span>Protocolo</span>
          <strong>{protocolo}</strong>
        </div>
      </div>

      <section className="imp-card">
        <header className="imp-card-head">
          <span className="imp-card-num">1</span>
          <div>
            <h3>Dados do envio</h3>
            <p>Confira o posto e informe para onde vai o retorno.</p>
          </div>
        </header>
        <dl className="imp-info">
          <div><dt>Usuário</dt><dd>{paUsuario || '—'}</dd></div>
          <div><dt>CNPJ</dt><dd>{cnpj ? formatCnpj(cnpj) : '—'}</dd></div>
          <div className="imp-info-wide"><dt>Razão social</dt><dd title={razaoSocial}>{razaoSocial || '—'}</dd></div>
        </dl>
        <div className="imp-fields">
          <div className="imp-field">
            <label htmlFor="man-email">E-mail de retorno <span className="imp-req">*</span></label>
            <input id="man-email" type="email" value={email} required placeholder="email@empresa.com"
              className={!email.trim() ? 'imp-vazio' : undefined} disabled={bloqueado}
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="imp-field">
            <label htmlFor="man-unidade">Unidade <span className="imp-req">*</span></label>
            <select id="man-unidade" value={unidade} required className={!unidade.trim() ? 'imp-vazio' : undefined}
              disabled={bloqueado} onChange={(e) => setUnidade(e.target.value)}>
              <option value="">Selecione a unidade</option>
              {UNIDADES.map((codigo) => <option key={codigo} value={String(codigo)}>DQS - {codigo}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="imp-card">
        <header className="imp-card-head">
          <span className="imp-card-num">2</span>
          <div>
            <h3>Produto</h3>
            <p>Mesmas colunas do modelo Excel. Campos com <span className="imp-req">*</span> são obrigatórios.</p>
          </div>
        </header>

        <div className="man-grid">
          <div className="imp-field c3">
            <label htmlFor="man-serial" title="Peça sem Serial Number: deixe em branco e o portal gera um identificador único no envio.">{rotuloCampo('serial')}</label>
            <input id="man-serial" ref={serialRef} type="text" value={form.serial} disabled={bloqueado} placeholder="Bipe, digite ou deixe em branco se não tiver"
              onChange={(e) => set('serial', e.target.value)}
              onBlur={(e) => set('serial', formatSerialValue(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set('serial', formatSerialValue(e.currentTarget.value)); } }} />
          </div>
          <div className="imp-field c3">
            <label htmlFor="man-nf">{rotuloCampo('notaFiscal')} <span className="imp-req">*</span></label>
            <input id="man-nf" type="text" value={form.notaFiscal} disabled={bloqueado} placeholder="Número da NF"
              onChange={(e) => set('notaFiscal', e.target.value)} />
          </div>
          <div className="imp-field c6">
            <label htmlFor="man-codigo">{rotuloCampo('codigo')} <span className="imp-req">*</span></label>
            <input id="man-codigo" type="text" value={form.codigo} disabled={bloqueado} placeholder="Digite e tecle Enter"
              aria-busy={consulta.status === 'carregando'} aria-describedby="man-produto"
              onChange={(e) => set('codigo', e.target.value)}
              onBlur={(e) => void consultarProduto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void consultarProduto(e.currentTarget.value); } }} />
            <div id="man-produto" role="status" aria-live="polite"
              className={`man-produto${consulta.status === 'encontrado' ? ' ok' : consulta.status === 'nao_encontrado' || consulta.status === 'erro' ? ' erro' : ''}`}>
              {consulta.status === 'carregando' && <><span className="imp-spinner" aria-hidden="true" /> Consultando produto...</>}
              {consulta.status === 'encontrado' && consulta.produto && (
                <><i className="material-icons">check_circle</i>
                  {consulta.produto.descricao}{consulta.produto.linha ? ` · ${consulta.produto.linha}` : ''}{consulta.produto.fornecedor ? ` · ${consulta.produto.fornecedor}` : ''}</>
              )}
              {consulta.status === 'nao_encontrado' && <><i className="material-icons">error_outline</i> Código {consulta.codigo} não encontrado no cadastro de produtos.</>}
              {consulta.status === 'erro' && <><i className="material-icons">error_outline</i> Falha ao consultar o produto. Tecle Enter para tentar de novo.</>}
            </div>
          </div>

          <div className="imp-field c6">
            <label htmlFor="man-defeito">{rotuloCampo('defeitoEncontrado')} <span className="imp-req">*</span></label>
            <input id="man-defeito" type="text" value={form.defeitoEncontrado} disabled={bloqueado} placeholder="Ex.: Tela quebrada"
              onChange={(e) => set('defeitoEncontrado', e.target.value)} />
          </div>
          <div className="imp-field c3">
            <label htmlFor="man-funcional">Defeito funcional <span className="imp-req">*</span></label>
            <select id="man-funcional" value={form.defeitoFuncional} disabled={bloqueado} onChange={(e) => set('defeitoFuncional', e.target.value)}>
              <option value="">Selecione</option><option value="SIM">SIM</option><option value="NAO">NÃO</option>
            </select>
          </div>
          <div className="imp-field c3">
            <label htmlFor="man-garantia">Garantia <span className="imp-req">*</span></label>
            <select id="man-garantia" value={form.garantia} disabled={bloqueado} onChange={(e) => set('garantia', e.target.value)}>
              <option value="">Selecione</option><option value="SIM">SIM</option><option value="NAO">NÃO</option>
            </select>
          </div>
          <div className="imp-field c3">
            <label htmlFor="man-avaria">Avaria estética <span className="imp-req">*</span></label>
            <select id="man-avaria" value={form.avariaEstetica} disabled={bloqueado} onChange={(e) => set('avariaEstetica', e.target.value)}
              title="SIM: a foto da avaria é obrigatória. NÃO: foto opcional.">
              <option value="">Selecione</option><option value="SIM">SIM (foto obrigatória)</option><option value="NAO">NÃO (foto opcional)</option>
            </select>
          </div>
          <div className="imp-field c3">
            <label htmlFor="man-tipo">{rotuloCampo('tipoOrc')} <span className="imp-req">*</span></label>
            <select id="man-tipo" value={form.tipoOrc} disabled={bloqueado} onChange={(e) => set('tipoOrc', e.target.value)}>
              <option value="">Selecione</option>
              {TIPOS_ORC.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </div>
        </div>

        <div className="man-sub">Peças</div>
        {editorLinhas('pecas', 'Nome da peça (ex.: DISPLAY)', 'man-sugestoes-peca')}
        <datalist id="man-sugestoes-peca">
          {sugestoesPeca.map((nome) => <option key={nome} value={nome} />)}
        </datalist>

        <div className="man-sub">Acessórios</div>
        {editorLinhas('acessorios', 'Nome do acessório (ex.: Controle remoto)')}

        <div className="man-sub">Outros valores</div>
        <div className="man-grid">
          {(['maoObra', 'embalagem', 'higienizacao'] as const).map((campo) => (
            <div className="imp-field c4" key={campo}>
              <label htmlFor={`man-${campo}`}>{rotuloCampo(campo)}</label>
              <input id={`man-${campo}`} type="text" inputMode="decimal" value={form[campo]} disabled={bloqueado} placeholder="0,00"
                onChange={(e) => set(campo, e.target.value)} onKeyDown={enterAdiciona} />
            </div>
          ))}
        </div>

        {pendenciasForm.length > 0 && (
          <div className="imp-alerta erro man-pend" role="alert">
            <i className="material-icons">error_outline</i>
            <div>
              <strong>Corrija antes de adicionar:</strong>
              <ul>{pendenciasForm.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          </div>
        )}

        <div className="man-acoes">
          <span className="man-total">Total do produto <strong>{formatCurrency(totalForm)}</strong></span>
          <button type="button" className="imp-btn imp-btn-ghost" disabled={bloqueado || adicionando}
            onClick={() => { setForm(formularioVazio()); setEvidenciasEdicao([]); setConsulta({ status: 'idle', codigo: '', produto: null }); setPendenciasForm([]); }}>
            <i className="material-icons">clear_all</i> Limpar
          </button>
          <button type="button" className="imp-btn man-btn-primary imp-btn-lg" disabled={bloqueado || adicionando || consulta.status === 'carregando'}
            onClick={() => void adicionarItem()}>
            {adicionando ? <span className="imp-spinner" aria-hidden="true" style={{ color: '#fff' }} /> : <i className="material-icons">add_circle</i>}
            {adicionando ? 'Conferindo...' : 'Adicionar ao lote'}
          </button>
        </div>
      </section>

      <section className="imp-card">
        <header className="imp-card-head">
          <span className="imp-card-num">3</span>
          <div>
            <h3>Itens do lote</h3>
            <p>Confira e envie. Para corrigir um item, clique em editar.</p>
          </div>
        </header>

        {avisoPadrao && (
          <div className="imp-alerta aviso" role="status">
            <i className="material-icons">info</i><div>{avisoPadrao}</div>
          </div>
        )}
        {catalogoPadrao && !concluido && (
          <PadronizacaoPecas padronizadas={padronizadas} semPadrao={semPadrao} rotuloPosicao="item" desabilitado={bloqueado} onAlternar={alternarPadrao} />
        )}

        {inconsistencias.length > 0 && (
          <div className="imp-alerta erro" role="alert">
            <i className="material-icons">block</i>
            <div>
              <strong>Envio bloqueado: edite os itens indicados abaixo.</strong>
              <ul className="imp-alerta-lista">
                {inconsistencias.map((inc) => (
                  <li key={inc.titulo}><strong>{inc.titulo}</strong> · item {inc.linhas.join(', ')}: {inc.detalhes.slice(0, 2).join(' ')}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {itens.length === 0 ? (
          <div className="imp-vazio-lista" style={{ background: 'var(--imp-fundo)', color: 'var(--imp-muted)' }}>
            <i className="material-icons">inventory_2</i> Nenhum produto adicionado ainda.
          </div>
        ) : (
          <div className="table-scroll novo-orcamento-resultado-tabela importacao-orc-scroll imp-tabela-wrap">
            <table className="tabela-horizontal importacao-orc-tabela imp-tabela">
              <thead>
                <tr>
                  <th>Situação</th>
                  <th>Observações</th>
                  <th>#</th>
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
                  <th>Evidências</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item, indice) => {
                  const valores = [
                    ...item.pecas.map((p) => `${p.nome}: ${formatCurrency(p.valor)}`),
                    ...item.acessorios.map((a) => `${a.nome} (acessório): ${formatCurrency(a.valor)}`),
                    ...(item.valMaoObra ? [`Mão de obra: ${formatCurrency(item.valMaoObra)}`] : []),
                    ...(item.valEmb ? [`Embalagem: ${formatCurrency(item.valEmb)}`] : []),
                    ...(item.valHig ? [`Higienização: ${formatCurrency(item.valHig)}`] : [])
                  ];
                  const situacao = situacaoItem(item);
                  return (
                    <tr key={item.chaveItem || item.serial || indice} className={itemBloqueado(item) ? 'resultado-erro' : item.pendencias.length ? 'resultado-atualizado' : 'resultado-importado'}>
                      <td><span className={`imp-pill ${situacao.tipo}`}>{situacao.texto}</span></td>
                      <td className="imp-obs">
                        {item.pendencias.length === 0 && <span className="imp-obs-ok">—</span>}
                        {item.pendencias.map((p) => (
                          <div key={p.mensagem} className={p.bloqueia ? 'importacao-orc-msg-erro' : 'importacao-orc-msg-aviso'}>{p.mensagem}</div>
                        ))}
                      </td>
                      <td>{indice + 1}</td>
                      {campoCelula(item, 'serial', serialExibido(item))}
                      {campoCelula(item, 'notaFiscal', item.notaFiscal)}
                      {campoCelula(item, 'codigo', item.codigo)}
                      <td>{item.produto?.descricao || '-'}</td>
                      {campoCelula(item, 'defeitoEncontrado', item.defeitoEncontrado)}
                      {campoCelula(item, 'defeitoFuncional', item.defeitoFuncional)}
                      {campoCelula(item, 'garantia', item.garantia)}
                      {campoCelula(item, 'tipoOrc', item.tipoOrc)}
                      <td>{valores.length ? valores.map((v) => <div key={v}>{v}</div>) : <span className="importacao-orc-vazio">sem valores</span>}</td>
                      <td className="imp-total">{formatCurrency(item.total)}</td>
                      <td>
                        <EvidenciasItem arquivos={item.evidencias || []} recomendado={item.avaria} linkDrive={item.linkDrive} serial={item.serial || `sem serial (item ${indice + 1})`}
                          desabilitado={bloqueado} onChange={(arquivos) => anexarEvidencias(indice, arquivos)} />
                      </td>
                      <td>
                        <div className="man-tabela-acoes">
                          <button type="button" className="man-icone editar" title="Editar" disabled={bloqueado} onClick={() => editarItem(indice)}>
                            <i className="material-icons">edit</i>
                          </button>
                          <button type="button" className="man-icone" title="Remover" disabled={bloqueado} onClick={() => removerItem(indice)}>
                            <i className="material-icons">delete</i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {erroEnvio && (
          <div className="imp-alerta erro" role="alert">
            <i className="material-icons">error_outline</i><div>{erroEnvio}</div>
          </div>
        )}

        {concluido ? (
          <div className="imp-sucesso" role="status">
            <i className="material-icons imp-sucesso-icone">check_circle</i>
            <div className="imp-sucesso-texto">
              <strong>Lote {concluido.protocolo} criado</strong>
              <span>
                {concluido.salvos} orçamento(s) salvo(s).
                {itens.some((item) => item.linkDrive) && ` Fotos e vídeos de ${itens.filter((item) => item.linkDrive).length} produto(s) enviados para o banco.`}
                {concluido.comFoto > 0 && ` ${concluido.comFoto} item(ns) com avaria sem foto aguardam a foto em Lançar Orçamentos.`}
                {concluido.fotosNaoEnviadas > 0 && ` Não foi possível enviar as fotos de ${concluido.fotosNaoEnviadas} produto(s) para o banco (${concluido.erroDrive}); os itens foram salvos mesmo assim.`}
                {itens.some((item) => item.serialGerado) && ` ${itens.filter((item) => item.serialGerado).length} peça(s) sem serial receberam identificador: baixe a lista e etiquete as peças.`}
                {' '}Finalize o lote em Meus Envios para mandar para aprovação.
              </span>
            </div>
            {itens.some((item) => item.serialGerado && item.serial) && (
              <button className="imp-btn imp-btn-ghost" type="button"
                onClick={() => { baixarIdentificadoresGerados(itens.map((item, i) => ({ ...item, linha: i + 1 })), concluido.protocolo).catch(() => setErroEnvio('Não foi possível gerar a lista de identificadores.')); }}>
                <i className="material-icons">qr_code_2</i> Baixar identificadores
              </button>
            )}
            <button className="imp-btn imp-btn-ghost" type="button" onClick={novoLote}>
              <i className="material-icons">add</i> Novo lote
            </button>
            <button className="imp-btn imp-btn-success" type="button" onClick={() => navigate('/meus-envios')}>
              <i className="material-icons">list_alt</i> Ir para Meus Envios
            </button>
          </div>
        ) : (
          <div className="imp-barra-envio">
            <div className="imp-barra-info">
              {enviando ? (
                <span className="imp-barra-status" role="status" aria-live="polite">
                  <span className="imp-spinner" aria-hidden="true" /> {etapaEnvio || 'Enviando...'}
                </span>
              ) : itens.length > 0 && !dadosOk ? (
                <span className="imp-barra-dica aviso">
                  <i className="material-icons">info</i> Preencha o e-mail de retorno e a unidade (etapa 1) antes de enviar.
                </span>
              ) : inconsistencias.length > 0 ? (
                <span className="imp-barra-dica">
                  <i className="material-icons">info</i> Envio bloqueado: corrija os {inconsistencias.length} ponto(s) indicados acima.
                </span>
              ) : (
                <span className="imp-barra-resumo">
                  <strong>{itens.length}</strong> produto{itens.length === 1 ? '' : 's'} · <strong>{formatCurrency(resumo.total)}</strong>
                </span>
              )}
            </div>
            <button className="imp-btn imp-btn-success imp-btn-lg" type="button" disabled={!podeEnviar} onClick={() => void enviarLote()}>
              <i className="material-icons">{erroEnvio && !enviando ? 'refresh' : 'send'}</i>
              {enviando ? 'Enviando...' : erroEnvio ? 'Tentar novamente' : `Enviar lote (${itens.length} produto${itens.length === 1 ? '' : 's'})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};

export default NovoOrcamento;
