import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const CHECK_URL = '/api-check-user';

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

  const hashSenha = async (senha: string) => {
    if (!window.crypto?.subtle) {
      throw new Error('Navegador sem suporte a criptografia. Use HTTPS ou localhost.');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(senha);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toBase64(digest);
  };

const Login = () => {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user || !pass) {
      setError('Preencha usuário e senha.');
      return;
    }

    try {
      setLoading(true);
      const senha_hash = await hashSenha(pass);
      const res = await fetch(CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: user, senha_hash })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Login inválido.');
      }

      const rawText = await res.text();
      const extractFirstJson = (text: string) => {
        const start = text.indexOf('{');
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < text.length; i += 1) {
          const ch = text[i];
          if (ch === '{') depth += 1;
          if (ch === '}') depth -= 1;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
        return null;
      };

      let data: any = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText);
        } catch {
          const sliced = extractFirstJson(rawText);
          if (sliced) {
            try {
              data = JSON.parse(sliced);
            } catch {
              data = null;
            }
          }
        }
      }

      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      const hasValidUser =
        items.length > 0 || (typeof data?.count === 'number' && data.count > 0) || !!data?.usuario;

      if (!hasValidUser) {
        throw new Error('Usuário ou senha inválidos.');
      }

      localStorage.setItem('gat_user', user.toUpperCase());
      navigate('/novo-orcamento');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao autenticar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
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

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
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
