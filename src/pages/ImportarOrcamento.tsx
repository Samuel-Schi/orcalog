import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { ErroImportacao, validarArquivoExcel } from '../lib/importacaoProdutos';
import {
  baixarIdentificadoresGerados,
  baixarModeloOrcamento,
  consultarProdutosOrcamento,
  serialExibido,
  definirEvidencias,
  inconsistenciasDoLote,
  itemBloqueado,
  lerPlanilhaOrcamento,
  type ErroLinhaOrcamento,
  type ItemOrcamentoPlanilha,
  type Pendencia
} from '../lib/importacaoOrcamento';
import { indexarCatalogoApi, type CatalogoPadrao } from '../lib/pecaPadrao';
import EvidenciasItem from '../components/EvidenciasItem';
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

type CampoTabela = Pendencia['campo'];

// Visual da tela (prefixo imp-), no mesmo tom azul do restante do portal.
// Exportado: o lancamento manual (Novo Orcamento) usa o mesmo visual.
export const estiloImportar = `
.imp-page { --imp-azul: var(--azul-escuro, #0056b3); --imp-azul-claro: #e7f1ff; --imp-borda: #e3e8ef; --imp-texto: #1f2937; --imp-muted: #6b7280; --imp-fundo: #f7f9fc; }
.imp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.imp-title { margin: 0 !important; }
.imp-subtitle { margin: 4px 0 0; color: var(--imp-muted); font-size: .9rem; }
.imp-protocolo { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--imp-borda); border-radius: 999px; background: #fff; font-size: .85rem; color: var(--imp-muted); }
.imp-protocolo .material-icons { font-size: 18px; color: var(--imp-azul); }
.imp-protocolo strong { color: var(--imp-texto); font-family: ui-monospace, Consolas, monospace; letter-spacing: .3px; }

.imp-stepper { list-style: none; display: flex; gap: 8px; padding: 0; margin: 0 0 14px; }
.imp-step { flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; background: #fff; border: 1px solid var(--imp-borda); color: var(--imp-muted); font-size: .85rem; min-width: 0; }
.imp-step-num { width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: .8rem; background: var(--imp-fundo); border: 1px solid var(--imp-borda); }
.imp-step-num .material-icons { font-size: 16px; }
.imp-step-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.imp-step.active { border-color: var(--imp-azul); color: var(--imp-azul); box-shadow: 0 0 0 3px rgba(0,86,179,.08); }
.imp-step.active .imp-step-num { background: var(--imp-azul); border-color: var(--imp-azul); color: #fff; }
.imp-step.done { color: #1e5e2f; }
.imp-step.done .imp-step-num { background: #28a745; border-color: #28a745; color: #fff; }

.imp-card { background: #fff; border: 1px solid var(--imp-borda); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(16,24,40,.04); min-width: 0; }
.imp-card-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.imp-card-head h3 { margin: 0; font-size: 1rem; font-weight: 700; color: var(--imp-texto); }
.imp-card-head p { margin: 2px 0 0; font-size: .82rem; color: var(--imp-muted); }
.imp-card-num { width: 28px; height: 28px; flex-shrink: 0; border-radius: 8px; background: var(--imp-azul-claro); color: var(--imp-azul); font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-size: .85rem; }
.imp-card-acao { margin-left: auto; }

.imp-info { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 12px; margin: 0 0 16px; padding: 12px 14px; background: var(--imp-fundo); border-radius: 10px; }
.imp-info div { min-width: 0; }
.imp-info dt { font-size: .72rem; text-transform: uppercase; letter-spacing: .4px; color: var(--imp-muted); font-weight: 600; }
.imp-info dd { margin: 2px 0 0; font-size: .9rem; color: var(--imp-texto); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imp-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.imp-field label { display: block; font-size: .82rem; font-weight: 600; color: var(--imp-texto); margin-bottom: 6px; }
.imp-req { color: #dc3545; }
.imp-field input, .imp-field select { height: 40px; border-radius: 8px; padding: 0 12px; font-size: .9rem; }
.imp-field .imp-vazio { border-color: #f0b429; background: #fffbeb; }

.imp-upload { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; align-items: stretch; }
.imp-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 170px; padding: 20px; text-align: center; border: 2px dashed #c5d3e6; border-radius: 12px; background: var(--imp-fundo); color: var(--imp-muted); font-size: .85rem; cursor: pointer; transition: border-color .15s, background .15s; outline: none; }
.imp-drop:hover, .imp-drop:focus-visible { border-color: var(--imp-azul); background: var(--imp-azul-claro); }
.imp-drop.arrastando { border-color: var(--imp-azul); background: var(--imp-azul-claro); transform: scale(1.01); }
.imp-drop.com-arquivo { border-style: solid; border-color: #b7dfc3; background: #f3faf5; }
.imp-drop.lendo { cursor: progress; border-style: solid; border-color: #b9d4f5; background: var(--imp-azul-claro); }
.imp-drop[aria-disabled="true"]:not(.lendo) { cursor: not-allowed; opacity: .6; }
.imp-drop strong { color: var(--imp-texto); font-size: .95rem; }
.imp-drop u { color: var(--imp-azul); text-decoration: none; font-weight: 600; }
.imp-drop-icone { font-size: 40px !important; color: var(--imp-azul); }
.imp-drop.com-arquivo .imp-drop-icone { color: #28a745; }
.imp-drop-arquivo-nome { overflow-wrap: anywhere; }
.imp-drop-lendo { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; max-width: 320px; }
.imp-drop-arquivo { font-size: .78rem; overflow-wrap: anywhere; }
.imp-progress { width: 100%; height: 8px; border-radius: 999px; background: #d6e4f5; overflow: hidden; }
.imp-progress div { height: 100%; background: var(--imp-azul); border-radius: inherit; transition: width .25s; }

.imp-dicas { list-style: none; margin: 0; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--imp-borda); display: flex; flex-direction: column; gap: 10px; font-size: .84rem; color: var(--imp-texto); }
.imp-dicas li { display: flex; gap: 10px; align-items: flex-start; line-height: 1.4; }
.imp-dicas .material-icons { font-size: 18px; color: var(--imp-azul); margin-top: 1px; }
.imp-dicas code { background: var(--imp-fundo); border: 1px solid var(--imp-borda); border-radius: 4px; padding: 0 4px; font-size: .8rem; }

.imp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 8px; border: 1px solid transparent; font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; transition: background .15s, border-color .15s, opacity .15s; white-space: nowrap; }
.imp-btn .material-icons { font-size: 18px; }
.imp-btn:disabled { opacity: .5; cursor: not-allowed; }
.imp-btn-ghost { background: #fff; border-color: var(--imp-borda); color: var(--imp-azul); }
.imp-btn-ghost:hover:not(:disabled) { border-color: var(--imp-azul); background: var(--imp-azul-claro); }
.imp-btn-success { background: #28a745; color: #fff; }
.imp-btn-success:hover:not(:disabled) { background: #218838; }
.imp-btn-lg { height: 44px; padding: 0 22px; font-size: .92rem; }

.imp-alerta { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px 14px; border-radius: 10px; font-size: .85rem; line-height: 1.45; }
.imp-alerta > .material-icons { font-size: 20px; flex-shrink: 0; }
.imp-alerta p { margin: 4px 0 0; }
.imp-alerta.erro { background: #fdecea; color: #8a1c24; border: 1px solid #f3c2c6; }
.imp-alerta.aviso { background: #fffbeb; color: #7c4a03; border: 1px solid #f3c96b; }
.imp-alerta-lista { margin: 6px 0 0; padding-left: 18px; max-height: 160px; overflow-y: auto; }

.imp-resumo { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 22px; padding: 10px 0; border-top: 1px solid var(--imp-borda); border-bottom: 1px solid var(--imp-borda); font-size: .88rem; color: var(--imp-muted); }
.imp-resumo-item strong { color: var(--imp-texto); font-size: 1rem; margin-right: 2px; }
.imp-resumo-item.aviso strong { color: #a16207; }
.imp-resumo-item.erro strong { color: #b42318; }
.imp-resumo-total { margin-left: auto; }
.imp-resumo-total strong { color: var(--imp-texto); font-size: 1rem; margin-left: 6px; }

.imp-filtro { display: inline-flex; gap: 4px; margin-top: 16px; padding: 4px; background: var(--imp-fundo); border: 1px solid var(--imp-borda); border-radius: 10px; }
.imp-filtro button { border: 0; background: transparent; padding: 6px 12px; border-radius: 7px; font: inherit; font-size: .82rem; font-weight: 600; color: var(--imp-muted); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.imp-filtro button span { background: #e5e7eb; color: var(--imp-texto); border-radius: 999px; padding: 0 7px; font-size: .74rem; }
.imp-filtro button.ativo { background: #fff; color: var(--imp-azul); box-shadow: 0 1px 2px rgba(16,24,40,.1); }
.imp-filtro button.ativo span { background: var(--imp-azul); color: #fff; }

.imp-vazio-lista { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 16px; border-radius: 10px; background: #f3faf5; color: #1e5e2f; font-size: .88rem; }
.imp-tabela-wrap { margin-top: 12px; border: 1px solid var(--imp-borda); border-radius: 10px; }
.imp-tabela thead th { position: sticky; top: 0; z-index: 1; }
.imp-pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: .74rem; font-weight: 700; white-space: nowrap; }
.imp-pill.ok { background: #e8f5ec; color: #1e5e2f; }
.imp-pill.aviso { background: #fff4d6; color: #8a5a00; }
.imp-pill.erro { background: #fdecea; color: #8a1c24; }
.imp-total { font-weight: 600; white-space: nowrap; }
.imp-tabela td.imp-obs { min-width: 240px; max-width: 320px; white-space: normal; overflow-wrap: anywhere; line-height: 1.35; }
.imp-obs .importacao-orc-msg-erro:first-child, .imp-obs .importacao-orc-msg-aviso:first-child { margin-top: 0; }
.imp-obs-ok { color: var(--imp-muted); }

.imp-barra-envio { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin: 16px -20px -18px; padding: 14px 20px; background: #fff; border-top: 1px solid var(--imp-borda); border-radius: 0 0 12px 12px; }
.imp-barra-info { flex: 1; min-width: 200px; font-size: .86rem; }
.imp-barra-dica { display: inline-flex; align-items: center; gap: 6px; color: #8a1c24; }
.imp-barra-dica.aviso { color: #8a5a00; }
.imp-barra-dica .material-icons { font-size: 18px; }
.imp-barra-status { display: inline-flex; align-items: center; gap: 8px; color: var(--imp-azul); font-weight: 600; }
.imp-barra-resumo { color: var(--imp-muted); }
.imp-barra-resumo strong { color: var(--imp-texto); }
/* Barra de envio acima da tabela (lote grande: nao precisa rolar ate o fim para enviar). */
.imp-barra-envio.topo { position: static; margin: 16px 0 0; padding: 12px 14px; background: var(--imp-fundo); border: 1px solid var(--imp-borda); border-radius: 10px; }
.imp-barra-erro { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: #8a1c24; cursor: pointer; text-align: left; }
.imp-barra-erro .material-icons { font-size: 18px; }
.imp-barra-erro u { text-underline-offset: 2px; }

.imp-paginacao { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: .82rem; color: var(--imp-muted); }
.imp-paginacao strong { color: var(--imp-texto); }
.imp-paginacao-botoes { display: inline-flex; align-items: center; gap: 6px; }
.imp-paginacao-botoes .imp-btn { height: 32px; padding: 0 10px; }
.imp-paginacao-pagina { min-width: 92px; text-align: center; font-weight: 600; color: var(--imp-texto); }

.imp-pop-fundo { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15, 23, 42, .55); }
.imp-pop { width: 100%; max-width: 440px; background: #fff; border-radius: 14px; box-shadow: 0 24px 60px rgba(15, 23, 42, .28); padding: 22px 22px 18px; display: grid; gap: 12px; text-align: center; }
.imp-pop-icone { width: 52px; height: 52px; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; background: #fdecea; color: #b42318; }
.imp-pop-icone .material-icons { font-size: 28px; }
.imp-pop h3 { margin: 0; font-size: 1.05rem; color: var(--imp-texto, #1f2937); }
.imp-pop p { margin: 0; font-size: .88rem; line-height: 1.5; color: #4b5563; overflow-wrap: anywhere; }
.imp-pop-acoes { display: flex; gap: 8px; justify-content: center; margin-top: 4px; }
.imp-pop-acoes .imp-btn { flex: 1; height: 42px; }
body.dark-mode .imp-pop { background: #1f2937; }
body.dark-mode .imp-pop h3 { color: #e2e8f0; }
body.dark-mode .imp-pop p { color: #cbd5e1; }

.imp-sucesso { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 16px; padding: 16px 18px; border-radius: 12px; background: #e8f5ec; border: 1px solid #b7dfc3; }
.imp-sucesso-icone { font-size: 36px !important; color: #28a745; }
.imp-sucesso-texto { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 2px; color: #1e5e2f; font-size: .88rem; }
.imp-sucesso-texto strong { font-size: 1rem; }

.imp-spinner { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: imp-girar .8s linear infinite; flex-shrink: 0; display: inline-block; color: var(--imp-azul); }
.imp-drop-lendo .imp-spinner { width: 26px; height: 26px; border-width: 3px; }
@keyframes imp-girar { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .imp-upload { grid-template-columns: 1fr; }
  .imp-resumo-total { margin-left: 0; width: 100%; }
  .imp-info { grid-template-columns: 1fr 1fr; }
  .imp-info-wide { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  .imp-step-label { display: none; }
  .imp-step { justify-content: center; }
  .imp-fields { grid-template-columns: 1fr; }
  .imp-card { padding: 16px; }
  .imp-card-head { flex-wrap: wrap; }
  .imp-card-acao { margin-left: 0; width: 100%; }
  .imp-barra-envio { margin: 16px -16px -16px; padding: 12px 16px; }
  .imp-barra-envio.topo { margin: 16px 0 0; padding: 12px; }
  .imp-barra-envio .imp-btn { width: 100%; }
  .imp-paginacao { justify-content: center; }
}
`;

const ITENS_POR_PAGINA = 20;

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
  const [pagina, setPagina] = useState(1);
  const [popupErro, setPopupErro] = useState(false);
  const tabelaRef = useRef<HTMLDivElement | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [etapaEnvio, setEtapaEnvio] = useState('');
  const [erroEnvio, setErroEnvio] = useState('');
  const [concluido, setConcluido] = useState<{ protocolo: string; salvos: number; comFoto: number; fotosNaoEnviadas: number; erroDrive: string } | null>(null);
  const [catalogoPadrao, setCatalogoPadrao] = useState<CatalogoPadrao | null>(null);
  const [catalogoFalhou, setCatalogoFalhou] = useState(false);
  const catalogoRef = useRef<Promise<CatalogoPadrao | null> | null>(null);
  const [avisoPadrao, setAvisoPadrao] = useState('');
  const [arrastando, setArrastando] = useState(false);
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
  // A leitura da planilha espera o catalogo: sem ele as pecas nao seriam padronizadas.
  useEffect(() => {
    let cancelled = false;
    catalogoRef.current = oracleApi.get(ORACLE_ENDPOINTS.getItemPadrao)
      .then((res) => indexarCatalogoApi(res.data))
      .catch(() => null);
    void catalogoRef.current.then((catalogo) => { if (!cancelled) { setCatalogoPadrao(catalogo); setCatalogoFalhou(!catalogo); } });
    return () => { cancelled = true; };
  }, []);

  const lerArquivo = async (selecionado: File) => {
    if (lendo || enviando) return;
    setArquivo(selecionado.name);
    setErroArquivo('');
    setAvisoPadrao('');
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
      // Padroniza o nome das pecas pela linha do produto.
      const catalogo = catalogoPadrao ?? await catalogoRef.current;
      if (catalogo) aplicarPadraoPecas(lido.itens, catalogo);
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
    return {
      bloqueados,
      comAviso,
      prontos: itens.length - bloqueados,
      total: itens.reduce((soma, item) => soma + item.total, 0)
    };
  }, [itens]);
  // Trava do envio: qualquer inconsistencia (linha nao lida, serial repetido, campo invalido) bloqueia o lote inteiro.
  const inconsistencias = useMemo(() => inconsistenciasDoLote(itens, errosLinha), [itens, errosLinha]);

  const podeEnviar = itens.length > 0 && inconsistencias.length === 0 && !lendo && !enviando && !concluido;

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
    try {
      const resultado = await enviarLoteOrcamento(itens, base, setEtapaEnvio);
      setConcluido({ protocolo, salvos: resultado.salvos, comFoto: resultado.comFoto, fotosNaoEnviadas: resultado.fotosNaoEnviadas, erroDrive: resultado.erroDrive });
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

  // Padronizacao automatica (nao trava o envio): parecidas ja trocadas (o posto pode desfazer) e desconhecidas
  // com o nome original; o pedido de padrao novo das desconhecidas e registrado depois do envio.
  const semPadrao = useMemo(() => gruposSemPadrao(itens), [itens]);
  const padronizadas = useMemo(() => gruposPadronizados(itens), [itens]);
  const alternarPadrao = (chave: string, desfazer: boolean) => setItens((atual) => alternarPadronizacao(atual, chave, desfazer));

  // Evidencias ficam no proprio item; o envio do lote sobe para o Drive.
  const anexarEvidencias = (alvo: ItemOrcamentoPlanilha, arquivos: File[]) => {
    setErroEnvio('');
    setItens((atual) => atual.map((item) => (item === alvo ? { ...definirEvidencias(item, arquivos) } : item)));
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
  // Paginacao da tabela: lote grande nao vira uma rolagem sem fim. Volta para a 1a pagina ao trocar filtro ou planilha.
  const totalPaginas = Math.max(1, Math.ceil(itensVisiveis.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicioPagina = (paginaAtual - 1) * ITENS_POR_PAGINA;
  const itensPagina = itensVisiveis.slice(inicioPagina, inicioPagina + ITENS_POR_PAGINA);
  useEffect(() => { setPagina(1); }, [soPendencias, itens.length]);
  const irParaPagina = (nova: number) => {
    setPagina(Math.min(Math.max(1, nova), totalPaginas));
    tabelaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // Erro do envio abre em pop-up (antes ficava escondido no fim da pagina).
  useEffect(() => { if (erroEnvio) setPopupErro(true); }, [erroEnvio]);
  useEffect(() => {
    if (!popupErro) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopupErro(false); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [popupErro]);
  const totalComPendencia = itens.filter((item) => item.pendencias.length > 0).length;
  const dadosOk = Boolean(email.trim() && unidade.trim());
  const temResultado = itens.length > 0 || errosLinha.length > 0;
  const etapaAtual = concluido ? 4 : temResultado ? 3 : dadosOk ? 2 : 1;
  const percentualLeitura = progressoLeitura.total
    ? Math.round((progressoLeitura.processados / progressoLeitura.total) * 100)
    : 0;

  const situacaoItem = (item: ItemOrcamentoPlanilha) => {
    if (itemBloqueado(item)) return { tipo: 'erro', texto: 'Pendente' };
    if (item.pendencias.length) return { tipo: 'aviso', texto: 'Pronto, com aviso' };
    return { tipo: 'ok', texto: 'Pronto' };
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    const selecionado = e.dataTransfer.files?.[0];
    if (selecionado) void lerArquivo(selecionado);
  };

  const etapas = [
    { n: 1, titulo: 'Dados do envio' },
    { n: 2, titulo: 'Planilha' },
    { n: 3, titulo: 'Conferência e envio' }
  ];

  return (
    <div id="viewImportarOrcamento" className="view-section novo-orcamento-page imp-page">
      <style>{estiloImportar}</style>

      <div className="imp-header">
        <div>
          <h2 className="page-title imp-title">Importar Orçamento</h2>
          <p className="imp-subtitle">Envie os orçamentos da unidade por planilha, confira e mande em lote.</p>
        </div>
        <div className="imp-protocolo" title="Protocolo do lote">
          <i className="material-icons">confirmation_number</i>
          <span>Protocolo</span>
          <strong>{protocolo}</strong>
        </div>
      </div>

      <ol className="imp-stepper" aria-label="Etapas da importação">
        {etapas.map((etapa) => {
          const estado = etapaAtual > etapa.n ? 'done' : etapaAtual === etapa.n ? 'active' : '';
          return (
            <li key={etapa.n} className={`imp-step ${estado}`}>
              <span className="imp-step-num">
                {estado === 'done' ? <i className="material-icons">check</i> : etapa.n}
              </span>
              <span className="imp-step-label">{etapa.titulo}</span>
            </li>
          );
        })}
      </ol>

      <section className="imp-card">
        <header className="imp-card-head">
          <span className="imp-card-num">1</span>
          <div>
            <h3>Dados do envio</h3>
            <p>Confira o posto e informe para onde vai o retorno.</p>
          </div>
        </header>

        <dl className="imp-info">
          <div><dt>Usuário</dt><dd>{localStorage.getItem('gat_user') || '—'}</dd></div>
          <div><dt>CNPJ</dt><dd>{cnpj ? formatCnpj(cnpj) : '—'}</dd></div>
          <div className="imp-info-wide"><dt>Razão social</dt><dd title={razaoSocial}>{razaoSocial || '—'}</dd></div>
        </dl>

        <div className="imp-fields">
          <div className="imp-field">
            <label htmlFor="imp-email">E-mail de retorno <span className="imp-req">*</span></label>
            <input
              id="imp-email"
              type="email"
              value={email}
              required
              placeholder="email@empresa.com"
              className={!email.trim() ? 'imp-vazio' : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="imp-field">
            <label htmlFor="imp-unidade">Unidade <span className="imp-req">*</span></label>
            <select
              id="imp-unidade"
              value={unidade}
              required
              className={!unidade.trim() ? 'imp-vazio' : undefined}
              onChange={(e) => setUnidade(e.target.value)}
            >
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
            <h3>Planilha do orçamento</h3>
            <p>Use o modelo: uma linha por produto.</p>
          </div>
          <button
            className="imp-btn imp-btn-ghost imp-card-acao"
            type="button"
            disabled={lendo || enviando}
            onClick={() => {
              baixarModeloOrcamento().catch(() => setErroArquivo('Não foi possível gerar o modelo. Tente novamente.'));
            }}
          >
            <i className="material-icons">download</i> Baixar modelo
          </button>
        </header>

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

        <div className="imp-upload">
          <div
            className={`imp-drop${arrastando ? ' arrastando' : ''}${lendo ? ' lendo' : ''}${arquivo && !lendo ? ' com-arquivo' : ''}`}
            role="button"
            tabIndex={lendo || enviando ? -1 : 0}
            aria-disabled={lendo || enviando}
            onClick={() => { if (!lendo && !enviando) arquivoInputRef.current?.click(); }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !lendo && !enviando) {
                e.preventDefault();
                arquivoInputRef.current?.click();
              }
            }}
            onDragOver={(e) => { e.preventDefault(); if (!lendo && !enviando) setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { if (lendo || enviando) { e.preventDefault(); setArrastando(false); return; } onDrop(e); }}
          >
            {lendo ? (
              <div className="imp-drop-lendo" role="status" aria-live="polite">
                <span className="imp-spinner" aria-hidden="true" />
                <strong>
                  {progressoLeitura.total
                    ? `Consultando produtos: ${progressoLeitura.processados} de ${progressoLeitura.total}`
                    : 'Lendo planilha...'}
                </strong>
                <div className="imp-progress"><div style={{ width: `${progressoLeitura.total ? percentualLeitura : 8}%` }} /></div>
                <span className="imp-drop-arquivo">{arquivo}</span>
              </div>
            ) : arquivo ? (
              <>
                <i className="material-icons imp-drop-icone">description</i>
                <strong className="imp-drop-arquivo-nome">{arquivo}</strong>
                <span>Clique ou arraste outra planilha para trocar</span>
              </>
            ) : (
              <>
                <i className="material-icons imp-drop-icone">cloud_upload</i>
                <strong>Arraste a planilha aqui</strong>
                <span>ou <u>clique para selecionar</u> · .xlsx ou .xls</span>
              </>
            )}
          </div>

          <ul className="imp-dicas">
            <li><i className="material-icons">table_rows</i><span>Preencha <strong>uma linha por produto</strong>.</span></li>
            <li><i className="material-icons">build</i><span>Peças e acessórios numa célula só: <code>Display: 300; Flex: 50</code>.</span></li>
            <li><i className="material-icons">fact_check</i><span>Antes de enviar, você vê o que ficou em branco ou inválido.</span></li>
            <li><i className="material-icons">list_alt</i><span>Depois, finalize o lote em <strong>Meus Envios</strong> para aprovação.</span></li>
          </ul>
        </div>

        {erroArquivo && (
          <div className="imp-alerta erro" role="alert">
            <i className="material-icons">error_outline</i><div>{erroArquivo}</div>
          </div>
        )}
      </section>

      {temResultado && (
        <section className="imp-card">
          <header className="imp-card-head">
            <span className="imp-card-num">3</span>
            <div>
              <h3>Conferência antes do envio</h3>
              <p>Revise os itens. Pendências precisam ser corrigidas na planilha.</p>
            </div>
          </header>

          <div className="imp-resumo">
            <div className="imp-resumo-item">
              <strong>{resumo.prontos}</strong> pronto{resumo.prontos === 1 ? '' : 's'}
            </div>
            <div className={`imp-resumo-item${resumo.comAviso ? ' aviso' : ''}`}>
              <strong>{resumo.comAviso}</strong> com aviso
            </div>
            <div className={`imp-resumo-item${resumo.bloqueados + errosLinha.length ? ' erro' : ''}`}>
              <strong>{resumo.bloqueados + errosLinha.length}</strong> com pendência
            </div>
            <div className="imp-resumo-total">
              Total do lote <strong>{formatCurrency(resumo.total)}</strong>
            </div>
          </div>

          {catalogoFalhou && (
            <div className="imp-alerta aviso" role="alert">
              <i className="material-icons">warning_amber</i>
              <div>Catálogo de peças indisponível agora: as peças não foram padronizadas. Recarregue a página antes de enviar.</div>
            </div>
          )}
          {avisoPadrao && (
            <div className="imp-alerta aviso" role="status">
              <i className="material-icons">info</i><div>{avisoPadrao}</div>
            </div>
          )}
          {catalogoPadrao && !concluido && (
            <PadronizacaoPecas padronizadas={padronizadas} semPadrao={semPadrao} desabilitado={enviando} onAlternar={alternarPadrao} />
          )}

          {inconsistencias.length > 0 && (
            <div className="imp-alerta erro" role="alert">
              <i className="material-icons">block</i>
              <div>
                <strong>Envio bloqueado: corrija {inconsistencias.length === 1 ? 'o ponto abaixo' : `os ${inconsistencias.length} pontos abaixo`} na planilha e envie o arquivo de novo.</strong>
                <ul className="imp-alerta-lista">
                  {inconsistencias.map((inc) => (
                    <li key={inc.titulo}>
                      <strong>{inc.titulo}</strong> · linha{inc.linhas.length === 1 ? '' : 's'} {inc.linhas.join(', ')}
                      {inc.detalhes.slice(0, 3).map((d) => <div key={d}>{d}</div>)}
                      {inc.detalhes.length > 3 && <div>… e mais {inc.detalhes.length - 3}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {concluido ? (
            <div className="imp-sucesso" role="status">
              <i className="material-icons imp-sucesso-icone">check_circle</i>
              <div className="imp-sucesso-texto">
                <strong>Lote {concluido.protocolo} criado</strong>
                <span>
                  {concluido.salvos} orçamento(s) salvo(s).
                  {itens.some((item) => item.linkDrive) && ` Fotos e vídeos de ${itens.filter((item) => item.linkDrive).length} produto(s) enviados ao Drive.`}
                  {concluido.comFoto > 0 && ` ${concluido.comFoto} item(ns) com avaria sem foto aguardam a foto em Lançar Orçamentos.`}
                  {concluido.fotosNaoEnviadas > 0 && ` Não foi possível enviar as fotos de ${concluido.fotosNaoEnviadas} produto(s) ao Drive (${concluido.erroDrive}); os itens foram salvos mesmo assim.`}
                  {itens.some((item) => item.serialGerado) && ` ${itens.filter((item) => item.serialGerado).length} peça(s) sem serial receberam identificador: baixe a lista e etiquete as peças.`}
                  {' '}Finalize o lote em Meus Envios para mandar para aprovação.
                </span>
              </div>
              {itens.some((item) => item.serialGerado && item.serial) && (
                <button className="imp-btn imp-btn-ghost" type="button"
                  onClick={() => { baixarIdentificadoresGerados(itens, concluido.protocolo).catch(() => setErroEnvio('Não foi possível gerar a lista de identificadores.')); }}>
                  <i className="material-icons">qr_code_2</i> Baixar identificadores
                </button>
              )}
              <button className="imp-btn imp-btn-success" type="button" onClick={() => navigate('/meus-envios')}>
                <i className="material-icons">list_alt</i> Ir para Meus Envios
              </button>
            </div>
          ) : (
            <div className="imp-barra-envio topo">
              <div className="imp-barra-info">
                {enviando ? (
                  <span className="imp-barra-status" role="status" aria-live="polite">
                    <span className="imp-spinner" aria-hidden="true" /> {etapaEnvio || 'Enviando...'}
                  </span>
                ) : erroEnvio ? (
                  <button type="button" className="imp-barra-erro" onClick={() => setPopupErro(true)}>
                    <i className="material-icons">error_outline</i>
                    <span>O envio não foi concluído. <u>Ver detalhes</u></span>
                  </button>
                ) : !podeEnviar && !lendo ? (
                  <span className="imp-barra-dica">
                    <i className="material-icons">info</i>
                    {inconsistencias.length
                      ? `Envio bloqueado: ${inconsistencias.length} inconsistência(s) para corrigir na planilha.`
                      : 'Envie uma planilha para conferir.'}
                  </span>
                ) : !dadosOk ? (
                  <span className="imp-barra-dica aviso">
                    <i className="material-icons">info</i>
                    Preencha o e-mail de retorno e a unidade (etapa 1) antes de enviar.
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

          {itens.length > 0 && (
            <div className="imp-filtro" role="tablist" aria-label="Filtrar itens">
              <button type="button" role="tab" aria-selected={!soPendencias} className={!soPendencias ? 'ativo' : ''} onClick={() => setSoPendencias(false)}>
                Todos <span>{itens.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={soPendencias} className={soPendencias ? 'ativo' : ''} onClick={() => setSoPendencias(true)}>
                Com pendência ou aviso <span>{totalComPendencia}</span>
              </button>
            </div>
          )}

          {itens.length > 0 && itensVisiveis.length === 0 && (
            <div className="imp-vazio-lista">
              <i className="material-icons">task_alt</i>
              Nenhum item com pendência ou aviso.
            </div>
          )}

          {itensVisiveis.length > 0 && (
          <div ref={tabelaRef} className="table-scroll novo-orcamento-resultado-tabela importacao-orc-scroll imp-tabela-wrap">
            <table className="tabela-horizontal importacao-orc-tabela imp-tabela">
              <thead>
                <tr>
                  <th>Situação</th>
                  <th>Observações</th>
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
                  <th>Evidências</th>
                </tr>
              </thead>
              <tbody>
                {itensPagina.map((item) => {
                  const bloqueado = itemBloqueado(item);
                  const valores = [
                    ...item.pecas.map((p) => `${p.nome}: ${formatCurrency(p.valor)}`),
                    ...item.acessorios.map((a) => `${a.nome} (acessório): ${formatCurrency(a.valor)}`),
                    ...(item.valMaoObra ? [`Mão de obra: ${formatCurrency(item.valMaoObra)}`] : []),
                    ...(item.valEmb ? [`Embalagem: ${formatCurrency(item.valEmb)}`] : []),
                    ...(item.valHig ? [`Higienização: ${formatCurrency(item.valHig)}`] : [])
                  ];
                  const situacao = situacaoItem(item);
                  return (
                    <tr key={item.chaveItem || item.serial} className={bloqueado ? 'resultado-erro' : item.pendencias.length ? 'resultado-atualizado' : 'resultado-importado'}>
                      <td><span className={`imp-pill ${situacao.tipo}`}>{situacao.texto}</span></td>
                      <td className="imp-obs">
                        {item.pendencias.length === 0 && <span className="imp-obs-ok">—</span>}
                        {item.pendencias.map((p) => (
                          <div key={p.mensagem} className={p.bloqueia ? 'importacao-orc-msg-erro' : 'importacao-orc-msg-aviso'}>{p.mensagem}</div>
                        ))}
                      </td>
                      <td>{item.linha}</td>
                      {celula(item, 'serial', serialExibido(item))}
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
                      <td className="imp-total">{formatCurrency(item.total)}</td>
                      <td>
                        <EvidenciasItem arquivos={item.evidencias || []} recomendado={item.avaria} linkDrive={item.linkDrive} serial={item.serial || `sem serial (linha ${item.linha})`}
                          desabilitado={enviando || Boolean(concluido)} onChange={(arquivos) => anexarEvidencias(item, arquivos)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          {itensVisiveis.length > ITENS_POR_PAGINA && (
            <nav className="imp-paginacao" aria-label="Paginação dos itens">
              <span>
                Mostrando <strong>{inicioPagina + 1}–{inicioPagina + itensPagina.length}</strong> de <strong>{itensVisiveis.length}</strong>
              </span>
              <span className="imp-paginacao-botoes">
                <button className="imp-btn imp-btn-ghost" type="button" disabled={paginaAtual <= 1} onClick={() => irParaPagina(paginaAtual - 1)} aria-label="Página anterior">
                  <i className="material-icons">chevron_left</i> Anterior
                </button>
                <span className="imp-paginacao-pagina" aria-live="polite">Página {paginaAtual} de {totalPaginas}</span>
                <button className="imp-btn imp-btn-ghost" type="button" disabled={paginaAtual >= totalPaginas} onClick={() => irParaPagina(paginaAtual + 1)} aria-label="Próxima página">
                  Próxima <i className="material-icons">chevron_right</i>
                </button>
              </span>
            </nav>
          )}
        </section>
      )}

      {popupErro && erroEnvio && createPortal(
        <div className="imp-pop-fundo" onClick={() => setPopupErro(false)}>
          <section className="imp-pop imp-page" role="alertdialog" aria-modal="true" aria-labelledby="imp-pop-titulo" aria-describedby="imp-pop-texto" onClick={(e) => e.stopPropagation()}>
            <span className="imp-pop-icone" aria-hidden="true"><i className="material-icons">error_outline</i></span>
            <h3 id="imp-pop-titulo">Não foi possível enviar o lote</h3>
            <p id="imp-pop-texto">{erroEnvio}</p>
            <div className="imp-pop-acoes">
              <button className="imp-btn imp-btn-ghost" type="button" onClick={() => setPopupErro(false)} autoFocus={!podeEnviar}>Fechar</button>
              {podeEnviar && (
                <button className="imp-btn imp-btn-success" type="button" autoFocus onClick={() => { setPopupErro(false); void enviarLote(); }}>
                  <i className="material-icons">refresh</i> Tentar novamente
                </button>
              )}
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ImportarOrcamento;
