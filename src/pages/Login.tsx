import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';

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
      const payload = { usuario: user, senha_hash };

      const res = await oracleApi.post(ORACLE_ENDPOINTS.checkUser, payload, {
        responseType: 'arraybuffer',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        validateStatus: (status) => status >= 200 && status < 400
      });

      const tryParseText = (raw: ArrayBuffer | string | null) => {
        if (!raw) return null;
        const tryDecode = (encoding: string) => {
          try {
            const decoder = new TextDecoder(encoding);
            return decoder.decode(typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw));
          } catch {
            return null;
          }
        };

        const utf8 = tryDecode('utf-8');
        const latin1 = tryDecode('iso-8859-1') || tryDecode('windows-1252');
        const text = (utf8 && !utf8.includes('\uFFFD') ? utf8 : latin1 || utf8 || '')
          .replace(/^\uFEFF/, '')
          .trim();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return null; }
      };

      const data = parseMaybeJson(res.data) ?? tryParseText(res.data as any);
      const rawItems = data?.items ?? data;
      let items: any[] = [];
      if (Array.isArray(rawItems)) {
        items = rawItems;
      } else if (typeof rawItems === 'string') {
        try {
          const parsed = JSON.parse(rawItems);
          if (Array.isArray(parsed)) items = parsed;
        } catch {
          // ignore
        }
      }

      const countValue = Number(data?.count);
      const hasValidUser =
        items.length > 0 ||
        (!Number.isNaN(countValue) && countValue > 0) ||
        !!data?.usuario ||
        !!data?.USUARIO;

      if (!hasValidUser) {
        throw new Error('Usuário ou senha inválidos.');
      }

      const first = items[0] || (Array.isArray(data?.items) ? data.items[0] : null) || data || {};
      const usuarioResp = (first?.usuario || first?.USUARIO || user).toString();
      localStorage.setItem('gat_user', usuarioResp.toUpperCase());
      if (first?.nome || first?.NOME) {
        localStorage.setItem('gat_user_nome', String(first?.nome ?? first?.NOME));
      }
      if (first?.email || first?.EMAIL) {
        localStorage.setItem('gat_user_email', String(first?.email ?? first?.EMAIL));
      }
      navigate('/novo-orcamento');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 405) {
        setError('Método não permitido (405). O endpoint exige GET em vez de POST.');
        return;
      }
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
      <footer className="fixed-footer">
        <div className="footer-stripe"></div>
        <div className="footer-text">© 2026 Gestão Assistência Técnica — Sistema de gestão de envio de orçamentos.</div>
      </footer>
    </div>
  );
};

export default Login;






