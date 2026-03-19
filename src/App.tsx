import { Navigate, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Cadastro from './pages/Cadastro';
import NovoOrcamento from './pages/NovoOrcamento';
import MeusEnvios from './pages/MeusEnvios';
import SidebarLayout from './components/SidebarLayout';

const isAuthenticated = () => {
  return Boolean(localStorage.getItem('ravenna_user'));
};

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route
        path="/"
        element={isAuthenticated() ? <Navigate to="/novo-orcamento" replace /> : <Navigate to="/login" replace />} 
      />
      <Route
        element={isAuthenticated() ? <SidebarLayout /> : <Navigate to="/login" replace />} 
      >
        <Route path="/novo-orcamento" element={<NovoOrcamento />} />
        <Route path="/meus-envios" element={<MeusEnvios />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
