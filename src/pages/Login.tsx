import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
const Login = () => {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user || !pass) {
      setError('Preencha usuário e senha.');
      return;
    }
    localStorage.setItem('ravenna_user', user.toUpperCase());
    navigate('/novo-orcamento');
  };

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="hero-brand">
          <div className="orcalog-wordmark" aria-label="Orçalog">
            <span className="orca">ORÇA</span>
            <span className="log">LOG</span>
          </div>
          <p>Sistema de gestão de envio de orçamentos</p>
        </div>
        <div className="hero-description">
          Centralize os envios de orçamento e acompanhe seus protocolos com rapidez e controle.
        </div>
        <div className="hero-cloud cloud-1" />
        <div className="hero-cloud cloud-2" />
        <div className="hero-cloud cloud-3" />
      </section>

      <section className="login-panel">
        <div className="login-box">
          <div className="login-box-header">
            <h2>Entrar no sistema</h2>
            <p>Insira suas credenciais para acessar o painel</p>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={onSubmit} className="login-form">
            <label className="login-label">Chave de Acesso</label>
            <div className="login-input">
              <i className="material-icons">person</i>
              <input
                type="text"
                placeholder="Digite seu usuário"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>

            <label className="login-label">Senha</label>
            <div className="login-input">
              <i className="material-icons">lock</i>
              <input
                type="password"
                placeholder="••••••••"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>

            <label className="login-remember">
              <input type="checkbox" />
              Lembrar de mim
            </label>

            <button className="login-submit" type="submit">
              Entrar
            </button>
          </form>

          <div className="login-footer">
            Não possui cadastro?{' '}
            <button type="button" className="login-link" onClick={() => navigate('/cadastro')}>
              Criar acesso
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Login;
