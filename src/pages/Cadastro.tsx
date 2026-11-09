import axios from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS } from '../lib/oracle';
import { estiloLogin } from './Login';

// Complementos do visual do login (pat-*) só para a tela de cadastro.
const estiloCadastro = `
.pat-form--cad .pat-field { margin-top: 18px; }
.pat-form--cad .pat-input { height: 48px; }
.pat-form--cad .pat-input[readonly] { color: var(--muted); cursor: default; }
.pat-form--cad .pat-input[readonly]:hover { border-color: transparent; }
.pat-form--cad .pat-input[readonly]:focus { background: var(--field); border-color: transparent; box-shadow: none; }
.pat-form--cad .pat-eye { top: 6px; }
.pat-hint { font-size: 12.5px; color: var(--muted); margin-top: 7px; }
.pat-ok { font-size: 12.5px; color: #1f7a4a; margin-top: 7px; }
.pat-form--cad .pat-err { margin-top: 14px; }
.pat-steps { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
.pat-step { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
.pat-step span { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; background: var(--field); color: var(--muted); border: 1px solid var(--line); }
.pat-step strong { font-weight: 500; }
.pat-step.active { color: var(--ink); }
.pat-step.active span { background: var(--navy); color: #fff; border-color: var(--navy); }
.pat-step.done span { background: var(--gold); color: var(--navy); border-color: var(--gold); }
.pat-step-line { flex: 1; height: 1px; background: var(--line); }
.pat-posto { display: flex; gap: 10px; }
.pat-posto-opt { flex: 1; height: 48px; display: inline-flex; align-items: center; gap: 10px; padding: 0 16px; font-size: 14px; color: var(--ink); background: var(--field); border: 1px solid transparent; border-radius: 10px; cursor: pointer; transition: border-color .15s, background .15s; }
.pat-posto-opt:hover { border-color: var(--line); }
.pat-posto-opt input { width: 16px; height: 16px; accent-color: var(--navy); }
.pat-posto-opt.active { background: #fff; border-color: var(--navy); box-shadow: 0 0 0 4px rgba(15,35,86,.08); }
.pat-form--cad .pat-submit { margin-top: 26px; }
.pat-actions { display: flex; gap: 10px; }
.pat-actions .pat-submit { flex: 1; }
.pat-back { margin-top: 26px; height: 52px; padding: 0 22px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--navy); font: inherit; font-size: 14.5px; font-weight: 500; cursor: pointer; }
.pat-back:hover { border-color: var(--navy); }
.pat-back:disabled { cursor: not-allowed; opacity: .6; }
.pat-form--cad { padding: 24px 0; }
`;

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};

const hashSenha = async (senha: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(senha);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64(digest);
};

const Cadastro = () => {
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [razao, setRazao] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [posto, setPosto] = useState<'INTERNO' | 'EXTERNO' | ''>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingCnpj, setLoadingCnpj] = useState(false);
  const [cnpjLookupFailed, setCnpjLookupFailed] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [showPass, setShowPass] = useState(false);

  const normalizarNomePosto = (value: string) =>
    value
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleUpperCase('pt-BR');

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5');
  };

  const onChangeCnpj = (value: string) => {
    const masked = formatCnpj(value);
    setCnpj(masked);
    setRazao('');
    setCnpjLookupFailed(false);
  };

  const buscarCnpj = async () => {
    const cnpjDigits = cnpj.replace(/\D/g, '');
    if (cnpjDigits.length !== 14 || loadingCnpj) return;

    try {
      setLoadingCnpj(true);
      setError('');

      const res = await oracleApi.get(ORACLE_ENDPOINTS.consultaCnpj, {
        params: { cnpj: cnpjDigits },
        validateStatus: () => true
      });

      if (res.status >= 400) {
        throw new Error('Não foi possível localizar esse CNPJ.');
      }

      const data = res.data ?? {};
      const razaoSocial = data.razao_social ?? data.nome ?? '';

      if (!razaoSocial) {
        throw new Error('CNPJ localizado, mas sem razao social disponivel.');
      }

      setRazao(normalizarNomePosto(String(razaoSocial)));
      setCnpjLookupFailed(false);
    } catch (err) {
      setCnpjLookupFailed(true);
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || err.response?.data?.error || 'Não foi possível consultar o CNPJ. Informe manualmente o nome do posto.');
      } else {
        const detail = err instanceof Error ? err.message : 'Não foi possível consultar o CNPJ.';
        setError(`${detail} Informe manualmente o nome do posto.`);
      }
    } finally {
      setLoadingCnpj(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!usuario || !senha || !cnpj || !razao || !telefone || !email || !nome || !posto) {
      setError('Preencha todos os campos antes de continuar.');
      return;
    }

    try {
      setLoading(true);
      const senha_hash = await hashSenha(senha);

      const cnpjDigits = cnpj.replace(/\D/g, '');
      const usuarioUpper = usuario.trim().toUpperCase();
      const payload = {
        usuario: usuarioUpper,
        senha: senha_hash,
        cnpj: cnpjDigits,
        razao_social: normalizarNomePosto(razao),
        telefone,
        email,
        nome,
        posto
      };

      const res = await oracleApi.post(ORACLE_ENDPOINTS.registerPosto, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (res.status >= 400) {
        console.error('Erro ORDS:', res.status, res.data);
        throw new Error(res.data || `Erro ao registrar (HTTP ${res.status}).`);
      }

      setSuccess('Cadastro enviado com sucesso! Você já pode fazer login.');
      setTimeout(() => navigate('/login'), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao cadastrar.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const validarPrimeiraEtapa = () => {
    if (!cnpj || !razao || !telefone || !email || !nome || !posto) {
      setError('Preencha os dados da unidade antes de continuar.');
      return false;
    }
    return true;
  };

  const avancarEtapa = () => {
    setError('');
    if (!validarPrimeiraEtapa()) return;
    setStep(2);
  };

  return (
    <div className="pat-login">
      <style>{estiloLogin}</style>
      <style>{estiloCadastro}</style>

      <div className="pat-brand">
        <div className="pat-brand-top">
          <span className="pat-brand-sq">AT</span>
          <span className="pat-brand-name">Portal AT</span>
        </div>
        <div className="pat-intro">
          <h1>Cadastre sua unidade e libere o acesso.</h1>
          <div className="pat-dash" />
          <p className="pat-lead">Informe os dados da unidade e crie suas credenciais para começar a enviar orçamentos.</p>
        </div>
        <div className="pat-ghost" aria-hidden="true">AT</div>
      </div>

      <div className="pat-formcol">
        <div className="pat-top">
          Já possui cadastro?
          <button type="button" onClick={() => navigate('/login')}>Entrar</button>
        </div>

        <div className="pat-center">
          <form className="pat-form pat-form--cad" onSubmit={onSubmit}>
            <h2>Criar acesso</h2>
            <p className="pat-sub">{step === 1 ? 'Etapa 1 de 2: dados da unidade' : 'Etapa 2 de 2: dados de acesso'}</p>

            <div className="pat-steps" aria-label="Progresso do cadastro">
              <div className={`pat-step ${step === 1 ? 'active' : 'done'}`}>
                <span>1</span>
                <strong>Unidade</strong>
              </div>
              <div className="pat-step-line" />
              <div className={`pat-step ${step === 2 ? 'active' : ''}`}>
                <span>2</span>
                <strong>Acesso</strong>
              </div>
            </div>

            {step === 1 && (
              <>
                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-cnpj">CNPJ</label>
                  <input
                    id="cad-cnpj"
                    className="pat-input"
                    type="text"
                    placeholder="00.000.000/0001-00"
                    value={cnpj}
                    onChange={(e) => onChangeCnpj(e.target.value)}
                    onBlur={buscarCnpj}
                  />
                  {loadingCnpj && <div className="pat-hint">Buscando razão social pelo CNPJ...</div>}
                </div>

                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-razao">{cnpjLookupFailed ? 'Nome do posto' : 'Razão Social'}</label>
                  <input
                    id="cad-razao"
                    className="pat-input"
                    type="text"
                    placeholder={cnpjLookupFailed ? 'Digite o nome do posto' : 'Preenchido pelo CNPJ'}
                    value={razao}
                    readOnly={!cnpjLookupFailed}
                    onChange={(e) => setRazao(e.target.value)}
                    onBlur={(e) => setRazao(normalizarNomePosto(e.target.value))}
                  />
                  {cnpjLookupFailed && (
                    <div className="pat-hint">
                      O nome será salvo em caixa alta e sem espaços duplicados, no padrão do retorno da consulta.
                    </div>
                  )}
                </div>

                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-nome">Nome do responsável</label>
                  <input
                    id="cad-nome"
                    className="pat-input"
                    type="text"
                    placeholder="Nome do responsável"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>

                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-email">E-mail de contato</label>
                  <input
                    id="cad-email"
                    className="pat-input"
                    type="email"
                    placeholder="contato@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-tel">Telefone</label>
                  <input
                    id="cad-tel"
                    className="pat-input"
                    type="text"
                    placeholder="(00) 00000-0000"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                  />
                </div>

                <div className="pat-field">
                  <span className="pat-label">Posto</span>
                  <div className="pat-posto">
                    <label className={`pat-posto-opt${posto === 'INTERNO' ? ' active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={posto === 'INTERNO'}
                        onChange={() => setPosto(posto === 'INTERNO' ? '' : 'INTERNO')}
                      />
                      Interno
                    </label>
                    <label className={`pat-posto-opt${posto === 'EXTERNO' ? ' active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={posto === 'EXTERNO'}
                        onChange={() => setPosto(posto === 'EXTERNO' ? '' : 'EXTERNO')}
                      />
                      Externo
                    </label>
                  </div>
                </div>

                {error && <div className="pat-err">{error}</div>}

                <button className="pat-submit" type="button" onClick={avancarEtapa}>
                  Continuar
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-user">Chave de acesso</label>
                  <input
                    id="cad-user"
                    className="pat-input"
                    type="text"
                    autoComplete="username"
                    placeholder="Usuário de acesso"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="pat-field">
                  <label className="pat-label" htmlFor="cad-pass">Senha</label>
                  <div className="pat-inputwrap">
                    <input
                      id="cad-pass"
                      className="pat-input pat-input--pw"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Crie uma senha"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                    />
                    <button
                      type="button"
                      className={`pat-eye${showPass ? ' on' : ''}`}
                      aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      onClick={() => setShowPass((v) => !v)}
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </button>
                  </div>
                </div>

                {error && <div className="pat-err">{error}</div>}
                {success && <div className="pat-ok">{success}</div>}

                <div className="pat-actions">
                  <button className="pat-back" type="button" onClick={() => setStep(1)} disabled={loading}>
                    Voltar
                  </button>
                  <button className={`pat-submit${loading ? ' is-loading' : ''}`} type="submit" disabled={loading}>
                    {loading ? 'Enviando...' : 'Finalizar cadastro'}
                  </button>
                </div>
              </>
            )}

            <div className="pat-signup">
              Já possui cadastro? <button type="button" onClick={() => navigate('/login')}>Entrar</button>
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

export default Cadastro;
