import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const SidebarLayout = () => {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => localStorage.getItem('ravennaTheme') === 'dark');
  const [isClosed, setIsClosed] = useState(() => localStorage.getItem('ravennaSidebar') === 'closed');
  const [userName, setUserName] = useState(() => localStorage.getItem('ravenna_user') || 'Usuário');

  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('ravennaTheme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-closed', isClosed);
    localStorage.setItem('ravennaSidebar', isClosed ? 'closed' : 'open');
  }, [isClosed]);

  const logout = () => {
    localStorage.removeItem('ravenna_user');
    navigate('/login');
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-area">
            <i className="material-icons">dns</i>
            <span className="logo-text">ORÇALOG</span>
          </div>
          <div className="header-actions">
            <button className="btn-header-icon" onClick={() => setIsClosed((v) => !v)} title="Recolher Menu">
              <i className="material-icons">{isClosed ? 'menu' : 'menu_open'}</i>
            </button>
            <button className="btn-header-icon" onClick={() => setIsDark((v) => !v)} title="Alternar Tema">
              <i className="material-icons">{isDark ? 'light_mode' : 'dark_mode'}</i>
            </button>
          </div>
        </div>

        <div className="user-profile">
          <div className="avatar-circle"><i className="material-icons">person</i></div>
          <span>{userName}</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/novo-orcamento" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="material-icons">add_circle</i>
            <span>Novo Orçamento</span>
          </NavLink>
          <NavLink to="/meus-envios" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="material-icons">list_alt</i>
            <span>Meus Envios</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <button className="nav-item btn-sair-sidebar" onClick={logout}>
            <i className="material-icons">logout</i>
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="content-body">
        <Outlet />
        <footer className="fixed-footer">
          <div className="footer-stripe"></div>
          <div className="footer-text">© 2026 Orçalog — Sistema de gestão de envio de orçamentos.</div>
        </footer>
      </main>
    </div>
  );
};

export default SidebarLayout;
