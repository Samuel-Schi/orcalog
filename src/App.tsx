import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { sessaoAtiva } from './lib/sessao';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import NovoOrcamento from './pages/NovoOrcamento';
import ImportarOrcamento from './pages/ImportarOrcamento';
import MeusEnvios from './pages/MeusEnvios';
import LancarOrcamentos from './pages/LancarOrcamentos';
import Romaneio from './pages/Romaneio';
import Pagamentos from './pages/Pagamentos';
import SidebarLayout from './components/SidebarLayout';

// Sem sessão, qualquer tela protegida vai para o login, que volta para o link pedido depois de entrar.
const RotaProtegida = () => {
  const location = useLocation();
  if (sessaoAtiva()) return <SidebarLayout />;
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
      <Route path="/cadastro" element={<Cadastro />} />
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
