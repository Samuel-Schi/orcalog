import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const SidebarLayout = () => {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => localStorage.getItem('gatTheme') === 'dark');
  const [isClosed, setIsClosed] = useState(() => localStorage.getItem('gatSidebar') === 'closed');
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [userName, setUserName] = useState(() => localStorage.getItem('gat_user') || 'Usuário');

  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('gatTheme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-closed', isClosed);
    localStorage.setItem('gatSidebar', isClosed ? 'closed' : 'open');
  }, [isClosed]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-mobile-open', isMobileOpen);
  }, [isMobileOpen]);

  const closeMobile = () => setIsMobileOpen(false);

  const logout = () => {
    localStorage.removeItem('gat_user');
    closeMobile();
    navigate('/login');
  };

  return (
    <div className="app-layout">
      <div className="mobile-topbar">
        <button className="btn-header-icon" onClick={() => setIsMobileOpen((v) => !v)} title="Menu">
          <i className="material-icons">menu</i>
        </button>
        <div className="mobile-title">Gestão Assistência Técnica</div>
        <button className="btn-header-icon" onClick={() => setIsDark((v) => !v)} title="Alternar Tema">
          <i className="material-icons">{isDark ? 'light_mode' : 'dark_mode'}</i>
        </button>
      </div>

      {isMobileOpen && (
        <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setIsMobileOpen(false)} />
      )}

      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-area">
            <i className="material-icons">dns</i>
            <span className="logo-text">
              <span>GESTÃO</span>
              <span>ASSISTÊNCIA</span>
              <span>TÉCNICA</span>
            </span>
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
          <NavLink to="/novo-orcamento" onClick={closeMobile} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="material-icons">add_circle</i>
            <span>Novo Orçamento</span>
          </NavLink>
          <NavLink to="/lancar-orcamentos" onClick={closeMobile} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <i className="material-icons">assignment</i>
            <span>Lançar Orçamentos</span>
          </NavLink>
          <NavLink to="/meus-envios" onClick={closeMobile} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
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
      </main>
    </div>
  );
};

export default SidebarLayout;
