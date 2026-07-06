import axios from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { oracleApi, ORACLE_ENDPOINTS } from '../lib/oracle';

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
  const [step, setStep] = useState<1 | 2>(1);

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

      setRazao(String(razaoSocial));
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || err.response?.data?.error || 'Erro ao consultar CNPJ.');
      } else {
        setError(err instanceof Error ? err.message : 'Erro ao consultar CNPJ.');
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
        razao_social: razao,
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
    <div className="login-shell">
      <section className="login-hero cadastro-hero">
        <div className="hero-kicker">Cadastro de unidades</div>
        <div className="hero-brand">
          <div className="cadastro-wordmark" aria-label="Portal AT">
            <span className="cadastro-wordmark-main">PORTAL</span>
            <span className="cadastro-wordmark-sub">AT</span>
          </div>
          <div className="brand-underline" aria-hidden="true">
            <span className="brand-underline-main" />
            <span className="brand-underline-dot" />
          </div>
          <div className="brand-domain">Portal de credenciamento e acesso operacional</div>
          <p>Sistema de gestão de envio de orçamentos</p>
        </div>
        <div className="hero-description">
          Cadastre sua unidade e libere o acesso para envio de orçamentos.
        </div>
        <div className="cadastro-highlights" aria-hidden="true">
          <div className="cadastro-highlight-card">
            <strong>1</strong>
            <span>Dados da unidade</span>
          </div>
          <div className="cadastro-highlight-card">
            <strong>2</strong>
            <span>Validação de acesso</span>
          </div>
          <div className="cadastro-highlight-card">
            <strong>3</strong>
            <span>Liberação para envio</span>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-box">
          <div className="login-box-header">
            <h2>Cadastro de Acesso</h2>
            <p>{step === 1 ? 'Etapa 1 de 2: dados da unidade' : 'Etapa 2 de 2: dados de acesso'}</p>
          </div>

          <div className="login-steps" aria-label="Progresso do cadastro">
            <div className={`login-step ${step === 1 ? 'active' : 'done'}`}>
              <span>1</span>
              <strong>Unidade</strong>
            </div>
            <div className={`login-step ${step === 2 ? 'active' : ''}`}>
              <span>2</span>
              <strong>Acesso</strong>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}
          {success && <div className="login-success">{success}</div>}

          <form onSubmit={onSubmit} className="login-form">
            {step === 1 && (
              <>
                <label className="login-label">CNPJ</label>
                <div className="login-input">
                  <i className="material-icons">business</i>
                  <input
                    type="text"
                    placeholder="00.000.000/0001-00"
                    value={cnpj}
                    onChange={(e) => onChangeCnpj(e.target.value)}
                    onBlur={buscarCnpj}
                  />
                </div>
                {loadingCnpj && (
                  <div style={{ color: '#64748b', fontSize: 13, marginTop: -8, marginBottom: 10 }}>
                    Buscando razao social pelo CNPJ...
                  </div>
                )}

                <label className="login-label">Razão Social</label>
                <div className="login-input">
                  <i className="material-icons">apartment</i>
                  <input
                    type="text"
                    placeholder="Razão social"
                    value={razao}
                    onChange={(e) => setRazao(e.target.value)}
                  />
                </div>

                <label className="login-label">Nome do responsável</label>
                <div className="login-input">
                  <i className="material-icons">person</i>
                  <input
                    type="text"
                    placeholder="Nome do responsável"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>

                <label className="login-label">E-mail de Contato</label>
                <div className="login-input">
                  <i className="material-icons">mail</i>
                  <input
                    type="email"
                    placeholder="contato@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <label className="login-label">Telefone</label>
                <div className="login-input">
                  <i className="material-icons">phone</i>
                  <input
                    type="text"
                    placeholder="(00) 00000-0000"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                  />
                </div>

                <label className="login-label">Posto</label>
                <div className="posto-group">
                  <label className={`posto-option ${posto === 'INTERNO' ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={posto === 'INTERNO'}
                      onChange={() => setPosto(posto === 'INTERNO' ? '' : 'INTERNO')}
                    />
                    Interno
                  </label>
                  <label className={`posto-option ${posto === 'EXTERNO' ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={posto === 'EXTERNO'}
                      onChange={() => setPosto(posto === 'EXTERNO' ? '' : 'EXTERNO')}
                    />
                    Externo
                  </label>
                </div>

                <div className="login-actions-row">
                  <button className="login-submit" type="button" onClick={avancarEtapa}>
                    Continuar
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <label className="login-label">Usuario</label>
                <div className="login-input">
                  <i className="material-icons">badge</i>
                  <input
                    type="text"
                    placeholder="Usuario de acesso"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value.toUpperCase())}
                  />
                </div>

                <label className="login-label">Senha</label>
                <div className="login-input">
                  <i className="material-icons">lock</i>
                  <input
                    type="password"
                    placeholder="Crie uma senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>

                <div className="login-actions-row login-actions-split">
                  <button className="login-secondary-action" type="button" onClick={() => setStep(1)}>
                    Voltar
                  </button>
                  <button className="login-submit" type="submit" disabled={loading}>
                    {loading ? 'Enviando...' : 'Finalizar Cadastro'}
                  </button>
                </div>
              </>
            )}
          </form>

          <div className="login-footer">
            Já possui cadastro?{' '}
            <button type="button" className="login-link" onClick={() => navigate('/login')}>
              Voltar para login
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Cadastro;
