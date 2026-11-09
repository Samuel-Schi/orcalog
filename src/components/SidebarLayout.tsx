import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Notificacoes from './Notificacoes';
import { encerrarSessao } from '../lib/sessao';

// Novo Orçamento / Lançar Orçamentos (item a item) fora do menu: a entrada é só pela planilha.
const MOSTRAR_LANCAMENTO_OPCIONAL = false;

const SidebarLayout = () => {
  const navigate = useNavigate();
  const [isClosed, setIsClosed] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('gatTheme', 'light');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('sidebar-closed', isClosed);
    localStorage.setItem('gatSidebar', isClosed ? 'closed' : 'open');
  }, [isClosed]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-mobile-open', isMobileOpen);
  }, [isMobileOpen]);

  const closeMobile = () => setIsMobileOpen(false);

  const logout = () => {
    encerrarSessao();
    closeMobile();
    navigate('/login');
  };

  const usuario = (localStorage.getItem('gat_user_nome') || localStorage.getItem('gat_user') || '').trim();
  const iniciais = usuario
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase() || 'AT';

  const itensMenu = [
    { to: '/importar-orcamento', icone: 'upload_file', texto: 'Importar Orçamento' },
    { to: '/meus-envios', icone: 'list_alt', texto: 'Meus Envios' },
    { to: '/romaneio', icone: 'print', texto: 'Romaneio' },
    { to: '/pagamentos', icone: 'payments', texto: 'Pagamentos' }
  ];

  return (
    <div className="app-layout">
      <div className="mobile-topbar">
        <button className="btn-header-icon" onClick={() => setIsMobileOpen((v) => !v)} aria-label="Abrir menu" title="Menu">
          <i className="material-icons">menu</i>
        </button>
        <div className="sb-marca">
          <img className="sb-marca-sq" src="/favicon.png" alt="AT" />
          <span className="sb-marca-nome">Portal AT</span>
        </div>
        <div className="mobile-topbar-spacer" />
      </div>

      {isMobileOpen && (
        <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setIsMobileOpen(false)} />
      )}

      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sb-marca">
            <img className="sb-marca-sq" src="/favicon.png" alt="AT" />
            <span className="sb-marca-nome">Portal AT</span>
          </div>
          <button
            className="btn-header-icon sb-recolher"
            onClick={() => setIsClosed((v) => !v)}
            aria-label={isClosed ? 'Expandir menu' : 'Recolher menu'}
            title={isClosed ? 'Expandir menu' : 'Recolher menu'}
          >
            <i className="material-icons">{isClosed ? 'chevron_right' : 'chevron_left'}</i>
          </button>
        </div>

        <nav className="sidebar-nav">
          {itensMenu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeMobile}
              title={isClosed ? item.texto : undefined}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <i className="material-icons">{item.icone}</i>
              <span>{item.texto}</span>
            </NavLink>
          ))}

          {/* Lancamento item a item (bipagem/manual): escondido do menu, entrada só por planilha.
              Rotas e telas continuam no código; para voltar, mude MOSTRAR_LANCAMENTO_OPCIONAL para true. */}
          {MOSTRAR_LANCAMENTO_OPCIONAL && (<>
          <div className="nav-grupo-opcional" title="Opcional: lançamento item a item">
            <span>Opcional</span>
          </div>
          <NavLink to="/novo-orcamento" onClick={closeMobile} className={({ isActive }) => `nav-item nav-item-opcional ${isActive ? 'active' : ''}`}>
            <i className="material-icons">add_circle</i>
            <span>Novo Orçamento</span>
          </NavLink>
          <NavLink to="/lancar-orcamentos" onClick={closeMobile} className={({ isActive }) => `nav-item nav-item-opcional ${isActive ? 'active' : ''}`}>
            <i className="material-icons">assignment</i>
            <span>Lançar Orçamentos</span>
          </NavLink>
          </>)}
        </nav>

        <div className="sidebar-footer">
          <Notificacoes />
          <div className="sb-usuario" title={usuario || undefined}>
            <span className="sb-avatar" aria-hidden="true">{iniciais}</span>
            <span className="sb-usuario-nome">{usuario || 'Usuário'}</span>
            <button className="sb-sair" onClick={logout} aria-label="Sair" title="Sair">
              <i className="material-icons">logout</i>
            </button>
          </div>
        </div>
      </aside>

      <main className="content-body">
        <Outlet />
      </main>
    </div>
  );
};

export default SidebarLayout;
