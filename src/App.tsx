import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import NovoOrcamento from './pages/NovoOrcamento';
import MeusEnvios from './pages/MeusEnvios';
import LancarOrcamentos from './pages/LancarOrcamentos';
import Romaneio from './pages/Romaneio';
import SidebarLayout from './components/SidebarLayout';

const isAuthenticated = () => {
  return Boolean(localStorage.getItem('gat_user'));
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
      <Route
        element={isAuthenticated() ? <SidebarLayout /> : <Navigate to="/login" replace />} 
      >
        <Route path="/novo-orcamento" element={<NovoOrcamento />} />
        <Route path="/lancar-orcamentos" element={<LancarOrcamentos />} />
        <Route path="/meus-envios" element={<MeusEnvios />} />
        <Route path="/romaneio" element={<Romaneio />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
