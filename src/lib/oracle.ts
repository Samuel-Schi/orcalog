import axios from 'axios';

export const ORDS_BASE_URL = '';

// Use sempre o proxy das Functions para evitar CORS no browser
export const ORACLE_ENDPOINTS = {
  checkUser: '/api-check-user',
  betUserInf: '/api-bet-user-inf',
  getUserInf: '/get_user_inf',
  getProdutoCadastro: '/get_produto_cadastro',
  consultaCnpj: '/consulta_cnpj',
  saveOrcamento: '/salvar-orcamento',
  syncOrcamentoSupabase: '/sync_orcamento_supabase',
  updateValores: '/update_valores',
  uploadFotoDrive: '/upload_foto_drive',
  getOrcamentosAnalise: '/get_orcamentos_analise',
  registerPosto: '/register_posto',
  postOrcamentoFinal: '/post_orcamento_final',
  getEnvios: '/get_envios'
};

export const oracleApi = axios.create({
  baseURL: ORDS_BASE_URL,
  timeout: 15000,
  transitional: {
    clarifyTimeoutError: true
  },
  headers: {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache'
  }
});

oracleApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        error.message = 'A requisicao demorou demais e foi interrompida.';
      } else if (!error.response) {
        error.message = 'Falha de rede ou servico indisponivel no momento.';
      }
    }

    return Promise.reject(error);
  }
);

export const decodeText = (input: unknown) => {
  if (typeof input === 'string') return input;
  if (input instanceof ArrayBuffer) {
    const tryDecode = (encoding: string) => {
      try {
        const decoder = new TextDecoder(encoding);
        return decoder.decode(new Uint8Array(input));
      } catch {
        return null;
      }
    };

    const utf8 = tryDecode('utf-8');
    if (utf8 && !utf8.includes('\uFFFD')) return utf8;

    const latin1 = tryDecode('iso-8859-1') || tryDecode('windows-1252');
    return latin1 || utf8 || null;
  }
  return null;
};

export const parseMaybeJson = (input: unknown) => {
  if (input instanceof ArrayBuffer) {
    const text = decodeText(input);
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/^\uFEFF/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // tenta extrair o primeiro JSON válido caso a resposta venha "colada"
      const trySlice = (openChar: '{' | '[', closeChar: '}' | ']') => {
        const start = cleaned.indexOf(openChar);
        if (start === -1) return null;
        let depth = 0;
        for (let i = start; i < cleaned.length; i += 1) {
          const ch = cleaned[i];
          if (ch === openChar) depth += 1;
          if (ch === closeChar) depth -= 1;
          if (depth === 0) {
            const sliced = cleaned.slice(start, i + 1);
            try {
              return JSON.parse(sliced);
            } catch {
              return null;
            }
          }
        }
        return null;
      };
      return trySlice('{', '}') ?? trySlice('[', ']');
    }
  }
  if (input && typeof input === 'object') return input as any;
  const text = decodeText(input);
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/^\uFEFF/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // tenta extrair o primeiro JSON válido caso a resposta venha "colada"
    const trySlice = (openChar: '{' | '[', closeChar: '}' | ']') => {
      const start = cleaned.indexOf(openChar);
      if (start === -1) return null;
      let depth = 0;
      for (let i = start; i < cleaned.length; i += 1) {
        const ch = cleaned[i];
        if (ch === openChar) depth += 1;
        if (ch === closeChar) depth -= 1;
        if (depth === 0) {
          const sliced = cleaned.slice(start, i + 1);
          try {
            return JSON.parse(sliced);
          } catch {
            return null;
          }
        }
      }
      return null;
    };

    // primeiro tenta objeto, depois array
    return trySlice('{', '}') ?? trySlice('[', ']');
  }
};

