// O login fica no localStorage (as telas leem gat_user e gat_user_profile), que sobrevive ao fechar o navegador.
// O cookie de sessão (sem expires) é apagado quando o navegador fecha: sem ele, o login salvo não vale mais.
const COOKIE_SESSAO = 'gat_sessao';
const CHAVES_USUARIO = ['gat_user', 'gat_user_profile', 'gat_user_nome', 'gat_user_email'];

const temCookieSessao = () => document.cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE_SESSAO}=`));

export const iniciarSessao = () => {
  document.cookie = `${COOKIE_SESSAO}=1; path=/; SameSite=Lax`;
};

export const encerrarSessao = () => {
  document.cookie = `${COOKIE_SESSAO}=; path=/; max-age=0; SameSite=Lax`;
  CHAVES_USUARIO.forEach((chave) => localStorage.removeItem(chave));
};

/** Logado = usuário salvo + cookie desta sessão do navegador; login antigo sem cookie é descartado. */
export const sessaoAtiva = () => {
  if (!localStorage.getItem('gat_user')) return false;
  if (temCookieSessao()) return true;
  encerrarSessao();
  return false;
};
