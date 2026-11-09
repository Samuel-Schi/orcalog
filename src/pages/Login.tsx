import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS, parseMaybeJson } from '../lib/oracle';
import { iniciarSessao } from '../lib/sessao';

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

export const estiloLogin = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap');
.pat-login * { box-sizing: border-box; margin: 0; padding: 0; }
.pat-login {
  --navy:#0f2356; --navy-2:#132b69; --ink:#0d1a3d; --gold:#f4bf1a;
  --muted:#6a7590; --line:#d9deea; --field:#f6f7fb;
  min-height: 100vh; background: #fff;
  font-family: 'Poppins', system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  display: grid; grid-template-columns: 44% 56%;
}
.pat-brand { position: relative; overflow: hidden; color: #fff; padding: 56px 60px; display: flex; flex-direction: column; background: linear-gradient(180deg, #132b69 0%, #0f2356 100%); }
.pat-brand-top { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.pat-brand-sq { width: 28px; height: 28px; border-radius: 7px; background: var(--gold); color: var(--navy); font-size: 11px; font-weight: 800; letter-spacing: .3px; display: inline-flex; align-items: center; justify-content: center; }
.pat-brand-name { font-size: 13px; font-weight: 500; color: rgba(255,255,255,.7); }
.pat-intro { margin-top: auto; margin-bottom: auto; max-width: 340px; position: relative; z-index: 1; }
.pat-intro h1 { font-size: 30px; font-weight: 500; line-height: 1.3; letter-spacing: -.5px; color: #fff; }
.pat-dash { width: 40px; height: 2px; background: var(--gold); margin: 26px 0; }
.pat-lead { font-size: 14px; line-height: 1.75; color: rgba(255,255,255,.62); }
.pat-ghost { position: absolute; right: -0.06em; bottom: -0.2em; font-size: clamp(260px, 30vw, 460px); font-weight: 800; line-height: 1; letter-spacing: -.06em; color: transparent; -webkit-text-stroke: 1.5px rgba(255,255,255,.10); user-select: none; pointer-events: none; }
.pat-formcol { display: flex; flex-direction: column; padding: 40px 56px; }
.pat-top { text-align: right; font-size: 13px; color: var(--muted); }
.pat-top button { color: var(--navy); font-weight: 600; margin-left: 6px; background: none; border: 0; cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
.pat-top button:hover { text-decoration: underline; }
.pat-center { flex: 1; display: flex; align-items: center; justify-content: center; }
.pat-form { width: 100%; max-width: 380px; text-align: left; }
.pat-form h2 { font-size: 26px; font-weight: 600; letter-spacing: -.5px; color: var(--ink); }
.pat-sub { margin-top: 6px; font-size: 14px; color: var(--muted); }
.pat-field { margin-top: 26px; }
.pat-label { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; font-weight: 500; margin-bottom: 9px; color: var(--ink); }
.pat-forgot { font-size: 12.5px; font-weight: 500; color: var(--muted); text-decoration: none; }
.pat-forgot:hover { color: var(--navy); text-decoration: underline; }
.pat-inputwrap { position: relative; }
.pat-input { width: 100%; height: 52px; padding: 0 16px; font-size: 14px; color: var(--ink); background: var(--field); border: 1px solid transparent; border-radius: 10px; outline: none; transition: border-color .15s, background .15s, box-shadow .15s; }
.pat-input--pw { padding-right: 52px; }
.pat-input::placeholder { color: #a3abbf; }
.pat-input:hover { border-color: var(--line); }
.pat-input:focus { background: #fff; border-color: var(--navy); box-shadow: 0 0 0 4px rgba(15,35,86,.08); }
.pat-input.invalid { border-color: #c4314b; background: #fff; }
.pat-err { font-size: 12.5px; color: #c4314b; margin-top: 7px; }
.pat-caps { font-size: 12.5px; color: #9a6700; margin-top: 7px; }
.pat-eye { position: absolute; right: 8px; top: 8px; width: 36px; height: 36px; background: none; border: 0; color: var(--muted); border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.pat-eye:hover { color: var(--navy); }
.pat-eye.on { color: var(--navy); }
.pat-remember { display: inline-flex; align-items: center; gap: 10px; margin-top: 20px; font-size: 13px; color: var(--muted); cursor: pointer; }
.pat-remember input { width: 16px; height: 16px; accent-color: var(--navy); }
.pat-submit { margin-top: 30px; width: 100%; height: 52px; border: 0; border-radius: 10px; background: var(--navy); color: #fff; font-size: 14.5px; font-weight: 500; letter-spacing: .2px; cursor: pointer; }
.pat-submit:hover { background: #0a1a44; }
.pat-submit:active { transform: scale(.99); }
.pat-submit:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }
.pat-submit.is-loading { opacity: .75; cursor: progress; }
.pat-submit:disabled { cursor: not-allowed; }
.pat-signup { display: none; }
.pat-footer { display: flex; justify-content: space-between; font-size: 12px; color: #9aa2b6; }
@media (max-width: 960px) {
  .pat-login { grid-template-columns: 1fr; }
  .pat-brand { min-height: 260px; padding: 32px 28px; }
  .pat-intro { margin: 36px 0 0; }
  .pat-intro h1 { font-size: 24px; }
  .pat-lead, .pat-dash { display: none; }
  .pat-ghost { font-size: 220px; }
  .pat-formcol { padding: 28px 24px 32px; }
  .pat-top { display: none; }
  .pat-center { align-items: flex-start; padding: 8px 0 40px; }
  .pat-signup { display: block; margin-top: 22px; text-align: center; font-size: 13px; color: var(--muted); }
  .pat-signup button { color: var(--navy); font-weight: 600; background: none; border: 0; cursor: pointer; font: inherit; font-weight: 600; padding: 0; }
  .pat-footer { flex-direction: column; gap: 4px; }
}
`;

const Login = () => {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [userInvalid, setUserInvalid] = useState(false);
  const [passInvalid, setPassInvalid] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  // Link que o usuário tentou abrir antes de logar (ex.: /romaneio); sem ele, a tela inicial.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const destino = from && from.startsWith('/') && !from.startsWith('/login') ? from : '/importar-orcamento';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const uEmpty = !user.trim();
    const pEmpty = !pass;
    setUserInvalid(uEmpty);
    setPassInvalid(pEmpty);
    if (uEmpty || pEmpty) {
      (uEmpty ? userRef : passRef).current?.focus();
      return;
    }

    try {
      setLoading(true);
      const senha_hash = await hashSenha(pass);
      const usuarioUpper = user.trim().toUpperCase();
      const payload = { usuario: usuarioUpper, senha_hash };

      const res = await oracleApi.get(ORACLE_ENDPOINTS.checkUser, {
        params: { ...payload, _ts: Date.now() },
        responseType: 'arraybuffer',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
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
        const text = (utf8 && !utf8.includes('�') ? utf8 : latin1 || utf8 || '')
          .replace(/^﻿/, '')
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
      localStorage.setItem('gat_user_profile', JSON.stringify({
        cnpj: first?.cnpj ?? first?.CNPJ ?? '',
        razao_social: first?.razao_social ?? first?.RAZAO_SOCIAL ?? '',
        email: first?.email ?? first?.EMAIL ?? '',
        nome: first?.nome ?? first?.NOME ?? '',
        posto: first?.posto ?? first?.POSTO ?? ''
      }));
      if (first?.nome || first?.NOME) {
        localStorage.setItem('gat_user_nome', String(first?.nome ?? first?.NOME));
      }
      if (first?.email || first?.EMAIL) {
        localStorage.setItem('gat_user_email', String(first?.email ?? first?.EMAIL));
      }
      iniciarSessao();
      navigate(destino, { replace: true });
      setTimeout(() => {
        if (window.location.pathname === '/login') {
          window.location.assign(destino);
        }
      }, 50);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao autenticar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pat-login">
      <style>{estiloLogin}</style>

      <div className="pat-brand">
        <div className="pat-brand-top">
          <span className="pat-brand-sq">AT</span>
          <span className="pat-brand-name">Portal AT</span>
        </div>
        <div className="pat-intro">
          <h1>Gestão de envio de orçamentos das unidades.</h1>
          <div className="pat-dash" />
          <p className="pat-lead">Centralize os envios de orçamento e acompanhe seus protocolos com rapidez e controle.</p>
        </div>
        <div className="pat-ghost" aria-hidden="true">AT</div>
      </div>

      <div className="pat-formcol">
        <div className="pat-top">
          Não possui cadastro?
          <button type="button" onClick={() => navigate('/cadastro')}>Criar acesso</button>
        </div>

        <div className="pat-center">
          <form className="pat-form" onSubmit={onSubmit} noValidate>
            <h2>Bem-vindo de volta</h2>
            <p className="pat-sub">Insira suas credenciais para acessar o painel.</p>

            <div className="pat-field">
              <label className="pat-label" htmlFor="pat-user">Chave de acesso</label>
              <div className="pat-inputwrap">
                <input
                  id="pat-user"
                  ref={userRef}
                  className={`pat-input${userInvalid ? ' invalid' : ''}`}
                  type="text"
                  name="user"
                  autoComplete="username"
                  placeholder="Digite seu usuário"
                  value={user}
                  disabled={loading}
                  onChange={(e) => { setUser(e.target.value.toUpperCase()); if (userInvalid) setUserInvalid(false); }}
                />
              </div>
              {userInvalid && <div className="pat-err">Informe a chave de acesso.</div>}
            </div>

            <div className="pat-field">
              <label className="pat-label" htmlFor="pat-pass">
                Senha
                <a className="pat-forgot" href="#">Esqueceu a senha?</a>
              </label>
              <div className="pat-inputwrap">
                <input
                  id="pat-pass"
                  ref={passRef}
                  className={`pat-input pat-input--pw${passInvalid ? ' invalid' : ''}`}
                  type={showPass ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={pass}
                  disabled={loading}
                  onChange={(e) => { setPass(e.target.value); if (passInvalid) setPassInvalid(false); }}
                  onKeyUp={(e) => setCapsOn(e.getModifierState('CapsLock'))}
                />
                <button
                  type="button"
                  className={`pat-eye${showPass ? ' on' : ''}`}
                  aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setShowPass((v) => !v)}
                  disabled={loading}
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
              {passInvalid && <div className="pat-err">Informe a senha.</div>}
              {capsOn && <div className="pat-caps">Caps Lock está ativado.</div>}
            </div>

            {error && <div className="pat-err">{error}</div>}

            <label className="pat-remember">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Lembrar de mim
            </label>

            <button type="submit" className={`pat-submit${loading ? ' is-loading' : ''}`} disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>

            <div className="pat-signup">
              Não possui cadastro? <button type="button" onClick={() => navigate('/cadastro')}>Criar acesso</button>
            </div>
          </form>
        </div>

        <div className="pat-footer">
          <span>© 2026 Inteligência Reversa &amp; Gotei</span>
          <span>Sistema de gestão de envio de orçamentos</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
