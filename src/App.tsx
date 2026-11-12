import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { sessaoAtiva } from './lib/sessao';
import Login from './pages/Login';
import SidebarLayout from './components/SidebarLayout';

// Cada tela vira um arquivo proprio, baixado so quando e aberta (o login abre sem carregar o resto).
// Depois de uma publicacao nova, a aba antiga pede um arquivo que nao existe mais: recarrega uma vez
// para pegar a versao atual em vez de mostrar erro.
const CHAVE_RECARGA = 'gat_recarga_versao';
const comRecarga = <T,>(carregar: () => Promise<T>) => () =>
  carregar().then(
    (modulo) => {
      try { sessionStorage.removeItem(CHAVE_RECARGA); } catch { /* sem storage */ }
      return modulo;
    },
    (erro) => {
      try {
        if (navigator.onLine && !sessionStorage.getItem(CHAVE_RECARGA)) {
          sessionStorage.setItem(CHAVE_RECARGA, '1');
          window.location.reload();
          return new Promise<T>(() => undefined);
        }
      } catch { /* sem storage */ }
      throw erro;
    }
  );

const telas = {
  cadastro: comRecarga(() => import('./pages/Cadastro')),
  novoOrcamento: comRecarga(() => import('./pages/NovoOrcamento')),
  importarOrcamento: comRecarga(() => import('./pages/ImportarOrcamento')),
  meusEnvios: comRecarga(() => import('./pages/MeusEnvios')),
  lancarOrcamentos: comRecarga(() => import('./pages/LancarOrcamentos')),
  romaneio: comRecarga(() => import('./pages/Romaneio')),
  pagamentos: comRecarga(() => import('./pages/Pagamentos'))
};
const Cadastro = lazy(telas.cadastro);
const NovoOrcamento = lazy(telas.novoOrcamento);
const ImportarOrcamento = lazy(telas.importarOrcamento);
const MeusEnvios = lazy(telas.meusEnvios);
const LancarOrcamentos = lazy(telas.lancarOrcamentos);
const Romaneio = lazy(telas.romaneio);
const Pagamentos = lazy(telas.pagamentos);

// Com o navegador ocioso, adianta o download das telas principais para a troca de menu ser imediata.
let telasAdiantadas = false;
const adiantarTelas = () => {
  if (telasAdiantadas) return;
  telasAdiantadas = true;
  // Aqui e so adiantamento: falha de rede nao recarrega a pagina (import direto, sem comRecarga).
  const baixar = () => {
    for (const tela of [
      () => import('./pages/ImportarOrcamento'),
      () => import('./pages/MeusEnvios'),
      () => import('./pages/Romaneio'),
      () => import('./pages/Pagamentos')
    ]) tela().catch(() => undefined);
  };
  const ocioso = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (ocioso) ocioso(baixar);
  else window.setTimeout(baixar, 1500);
};

// Sem sessão, qualquer tela protegida vai para o login, que volta para o link pedido depois de entrar.
const RotaProtegida = () => {
  const location = useLocation();
  if (sessaoAtiva()) {
    adiantarTelas();
    return <SidebarLayout />;
  }
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
};

const App = () => {
  useEffect(() => {
    try {
      localStorage.removeItem('gat_orc_pendentes');
      localStorage.removeItem('gat_orc_recem_enviados');
    } catch {
      return;
    }
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Suspense fallback={null}><Cadastro /></Suspense>} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route element={<RotaProtegida />}>
        <Route path="/novo-orcamento" element={<NovoOrcamento />} />
        <Route path="/importar-orcamento" element={<ImportarOrcamento />} />
        <Route path="/lancar-orcamentos" element={<LancarOrcamentos />} />
        <Route path="/meus-envios" element={<MeusEnvios />} />
        <Route path="/romaneio" element={<Romaneio />} />
        <Route path="/pagamentos" element={<Pagamentos />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
