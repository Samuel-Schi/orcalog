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

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="hero-brand">
          <div className="orcalog-wordmark" aria-label="Gestão Assistência Técnica">
            <span className="orca">GESTÃO</span>
            <span className="log">ASSISTÊNCIA TÉCNICA</span>
          </div>
          <p>Sistema de gestão de envio de orçamentos</p>
        </div>
        <div className="hero-description">
          Cadastre sua unidade e libere o acesso para envio de orçamentos.
        </div>
        <div className="hero-cloud cloud-1" />
        <div className="hero-cloud cloud-2" />
        <div className="hero-cloud cloud-3" />
      </section>

      <section className="login-panel">
        <div className="login-box">
          <div className="login-box-header">
            <h2>Cadastro de Acesso</h2>
            <p>Preencha os dados da unidade para solicitar login</p>
          </div>

          {error && <div className="login-error">{error}</div>}
          {success && <div className="login-success">{success}</div>}

          <form onSubmit={onSubmit} className="login-form">
            <label className="login-label">CNPJ</label>
            <div className="login-input">
              <i className="material-icons">business</i>
              <input
                type="text"
                placeholder="00.000.000/0001-00"
                value={cnpj}
                onChange={(e) => onChangeCnpj(e.target.value)}
              />
            </div>
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

            <label className="login-label">Usuário</label>
            <div className="login-input">
              <i className="material-icons">badge</i>
              <input
                type="text"
                placeholder="Usuário de acesso"
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

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar Cadastro'}
            </button>
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




