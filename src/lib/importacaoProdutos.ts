// SheetJS e carregado sob demanda para nao pesar no bundle principal.
const carregarXlsx = () => import('xlsx');

export type ItemProduto = {
  id: string;
  protocolo: string;
  uuid: string;
  ean: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  status: number;
};

export type ProdutoApi = {
  codGemco: string;
  descricao: string;
  ean: string;
  uuid: string;
  fornecedor: string;
  linha: string;
};

export type LinhaPlanilha = {
  linha: number;
  uuid: string;
  serial: string;
  codGemco: string;
};

export type ResultadoLinha = {
  linha: number;
  serial: string;
  codGemco: string;
  status: 'importado' | 'atualizado' | 'erro';
  mensagem: string;
};

export class ErroImportacao extends Error {}

export const EXTENSOES_EXCEL = ['.xlsx', '.xls'];
export const TAMANHO_MAXIMO_ARQUIVO = 5 * 1024 * 1024;
export const LIMITE_LINHAS = 2000;

export const compactLookupValue = (value: string) =>
  value.replace(/[^0-9a-z]/gi, '').toUpperCase().trim();

export const parseSerialPayload = (raw: string) => {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
  if (!cleaned) return '';

  if (cleaned.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleaned);
      const serialValue =
        parsed?.serial
        ?? parsed?.SERIAL
        ?? parsed?.sn
        ?? parsed?.SN
        ?? parsed?.serialNumber
        ?? parsed?.serial_number
        ?? parsed?.imei
        ?? parsed?.IMEI;

      if (serialValue) {
        return String(serialValue);
      }
    } catch {
      // ignore malformed JSON and continue with plain-text parsing
    }
  }

  const labelMatch = cleaned.match(/(?:serial(?:number)?|sn|imei)[^0-9a-z]*([0-9a-z-]+)/i);
  if (labelMatch?.[1]) {
    return labelMatch[1];
  }

  return cleaned;
};

export const formatSerialValue = (raw: string) => {
  const compact = compactLookupValue(parseSerialPayload(raw));
  if (!compact) return '';
  if (compact.length <= 4) return compact;
  return compact.match(/.{1,4}/g)?.join('-') ?? compact;
};

const getCampo = (source: any, keys: string[]) => {
  if (!source || typeof source !== 'object') return '';
  const lowerMap = new Map<string, string>();
  Object.keys(source).forEach((k) => lowerMap.set(k.toLowerCase(), k));
  for (const key of keys) {
    const realKey = lowerMap.get(key.toLowerCase());
    if (realKey && source[realKey] !== null && source[realKey] !== undefined) {
      const value = String(source[realKey]).trim();
      if (value) return value;
    }
  }
  return '';
};

// Mesmos aliases usados nas consultas de produto do Oracle (cadastro e codigo de barras).
export const extrairProdutoApi = (data: any): ProdutoApi => {
  const rows: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const produto = rows[0] ?? (Array.isArray(data) ? {} : data) ?? {};
  return {
    codGemco: getCampo(produto, ['item', 'cod_gemco', 'codigo', 'cod_item', 'item_codigo']),
    descricao: getCampo(produto, ['descricao', 'ds_produto', 'descricao_produto', 'desc_produto', 'description', 'produto']),
    ean: getCampo(produto, ['cod_barra', 'codigo_barra', 'codigo_barras', 'ean']).replace(/\D/g, ''),
    uuid: getCampo(produto, ['uuid', 'id_unico']),
    fornecedor: getCampo(produto, ['fornecedor', 'ds_fornecedor', 'desc_fornecedor', 'fornecedor_desc', 'nome_fornecedor']),
    linha: getCampo(produto, ['linha', 'ds_linha', 'desc_linha', 'linha_desc', 'nome_linha'])
  };
};

export type ResultadoConsultaEan =
  | { status: 'encontrado'; mensagem: string; produto: ProdutoApi }
  | { status: 'nao_encontrado' | 'erro'; mensagem: string };

export type TipoCodigoProduto = 'gemco' | 'ean';

export const normalizarCodigoProduto = (tipo: TipoCodigoProduto, valor: string) =>
  tipo === 'ean' ? String(valor ?? '').replace(/\D/g, '') : compactLookupValue(String(valor ?? ''));

export const consultarProdutoPorCodigo = async (
  tipo: TipoCodigoProduto,
  valor: string,
  buscar: (codigo: string) => Promise<unknown>
): Promise<ResultadoConsultaEan> => {
  const codigo = normalizarCodigoProduto(tipo, valor);
  const rotulo = tipo === 'ean' ? 'Código de barras' : 'Gemco';
  const naoEncontrado = { status: 'nao_encontrado' as const, mensagem: `${rotulo} ${codigo} não encontrado no cadastro de produtos. Preencha os dados manualmente.` };
  if (tipo === 'ean' && codigo.length < 8) return { status: 'erro', mensagem: 'Código de barras inválido: informe ao menos 8 dígitos.' };
  if (!codigo) return { status: 'erro', mensagem: 'Informe o Gemco.' };
  try {
    const produto = extrairProdutoApi(await buscar(codigo));
    if (!produto.descricao && !produto.fornecedor && !produto.linha) return naoEncontrado;
    return {
      status: 'encontrado',
      mensagem: `Descrição, fornecedor e linha preenchidos pelo ${tipo === 'ean' ? 'código de barras' : 'Gemco'}.`,
      produto: {
        ...produto,
        ean: produto.ean || (tipo === 'ean' ? codigo : ''),
        codGemco: produto.codGemco || (tipo === 'gemco' ? codigo : '')
      }
    };
  } catch (error) {
    if ((error as { response?: { status?: number } })?.response?.status === 404) return naoEncontrado;
    return { status: 'erro', mensagem: `Não foi possível consultar o ${tipo === 'ean' ? 'código de barras' : 'Gemco'} agora. Tente novamente ou preencha manualmente.` };
  }
};

export const consultarCodigoBarras = (valor: string, buscar: (codigoBarras: string) => Promise<unknown>) =>
  consultarProdutoPorCodigo('ean', valor, buscar);

// Digitacao manual: serial e ID unico obrigatorios; basta Gemco OU codigo de barras.
export const validarItemManual = (valores: { serial: string; uuid: string; codGemco: string; ean: string; descricao: string }) => {
  const preenchido = (valor: string) => Boolean(valor.trim()) && valor.trim() !== '-';
  if (!preenchido(valores.serial)) return 'Obrigatorio preencher o serial.';
  if (!preenchido(valores.uuid)) return 'Obrigatorio preencher o ID único.';
  if (!preenchido(valores.codGemco) && !preenchido(valores.ean)) return 'Informe o Gemco ou o código de barras.';
  if (!preenchido(valores.descricao)) return 'Obrigatorio preencher a descricao do produto. Informe o Gemco ou o código de barras para buscar automaticamente.';
  return '';
};

// Um produto do protocolo e a unidade fisica: mesmo serial do mesmo codigo GEMCO.
export const chaveProduto = (item: Pick<ItemProduto, 'serial' | 'codGemco'>) =>
  `${compactLookupValue(item.serial || '')}|${compactLookupValue(item.codGemco || '')}`;

// Serial e ID unico identificam a unidade: nenhum dos dois pode se repetir no protocolo ('-' = nao informado).
export const motivoProdutoRepetido = (
  novo: Pick<ItemProduto, 'serial' | 'uuid'>,
  itens: Pick<ItemProduto, 'serial' | 'uuid'>[]
) => {
  const serial = compactLookupValue(novo.serial || '');
  const uuid = compactLookupValue(novo.uuid || '');
  if (serial && itens.some((item) => compactLookupValue(item.serial || '') === serial)) return 'Este serial já está no protocolo.';
  if (uuid && itens.some((item) => compactLookupValue(item.uuid || '') === uuid)) return 'Este ID único já está no protocolo.';
  return '';
};

const normalizarCabecalho = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

const COLUNAS: Record<keyof Omit<LinhaPlanilha, 'linha'>, { rotulo: string; aliases: string[] }> = {
  uuid: { rotulo: 'ID único', aliases: ['idunico', 'uuid', 'id'] },
  serial: { rotulo: 'Serial', aliases: ['serial', 'numerodeserie', 'numeroserie', 'serialnumber', 'sn'] },
  codGemco: { rotulo: 'Gemco', aliases: ['gemco', 'codgemco', 'codigogemco', 'codigodogemco', 'itemgemco'] }
};

export const COLUNAS_OBRIGATORIAS = Object.values(COLUNAS).map((coluna) => coluna.rotulo);

const textoCelula = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('fullwide', { useGrouping: false }) : String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '').trim();
};

const mapearCabecalho = (row: unknown[]) => {
  const indices: Partial<Record<keyof typeof COLUNAS, number>> = {};
  row.forEach((celula, index) => {
    const nome = normalizarCabecalho(celula);
    (Object.keys(COLUNAS) as (keyof typeof COLUNAS)[]).forEach((campo) => {
      if (indices[campo] === undefined && COLUNAS[campo].aliases.includes(nome)) indices[campo] = index;
    });
  });
  return indices;
};

/**
 * Converte as linhas cruas da planilha (primeira linha util = cabecalho) em linhas validadas.
 * `primeiraLinha` e o numero da linha do Excel correspondente a rows[0].
 */
export const interpretarLinhas = (rows: unknown[][], primeiraLinha = 1) => {
  const campos = Object.keys(COLUNAS) as (keyof typeof COLUNAS)[];
  let melhor = { posicao: -1, indices: {} as ReturnType<typeof mapearCabecalho> };
  for (let posicao = 0; posicao < Math.min(rows.length, 10); posicao += 1) {
    const indices = mapearCabecalho(rows[posicao] || []);
    if (Object.keys(indices).length > Object.keys(melhor.indices).length) melhor = { posicao, indices };
    if (Object.keys(indices).length === campos.length) break;
  }

  const faltando = campos.filter((campo) => melhor.indices[campo] === undefined).map((campo) => COLUNAS[campo].rotulo);
  if (faltando.length) {
    throw new ErroImportacao(`Coluna(s) obrigatória(s) não encontrada(s): ${faltando.join(', ')}. O cabeçalho deve conter: ${COLUNAS_OBRIGATORIAS.join(', ')}.`);
  }

  const linhas: LinhaPlanilha[] = [];
  const erros: ResultadoLinha[] = [];
  rows.slice(melhor.posicao + 1).forEach((row, index) => {
    const valor = (campo: keyof typeof COLUNAS) => textoCelula((row || [])[melhor.indices[campo] as number]);
    const linha = primeiraLinha + melhor.posicao + 1 + index;
    const uuid = valor('uuid').replace(/\D/g, '');
    const serial = formatSerialValue(valor('serial'));
    const codGemco = compactLookupValue(valor('codGemco'));
    if (!valor('uuid') && !valor('serial') && !valor('codGemco')) return;

    if (!serial) {
      erros.push({ linha, serial, codGemco, status: 'erro', mensagem: 'Serial não informado.' });
    } else if (!codGemco && !uuid) {
      erros.push({ linha, serial, codGemco, status: 'erro', mensagem: 'Informe o Gemco ou o ID único para consultar o produto.' });
    } else {
      linhas.push({ linha, uuid, serial, codGemco });
    }
  });

  if (!linhas.length && !erros.length) throw new ErroImportacao('A planilha não possui linhas de produtos abaixo do cabeçalho.');
  if (linhas.length + erros.length > LIMITE_LINHAS) {
    throw new ErroImportacao(`A planilha excede o limite de ${LIMITE_LINHAS} linhas por importação.`);
  }
  return { linhas, erros };
};

export const validarArquivoExcel = (arquivo: { name: string; size: number }) => {
  const nome = arquivo.name.toLowerCase();
  if (!EXTENSOES_EXCEL.some((extensao) => nome.endsWith(extensao))) {
    throw new ErroImportacao('Formato inválido. Selecione um arquivo Excel (.xlsx ou .xls).');
  }
  if (arquivo.size === 0) throw new ErroImportacao('O arquivo selecionado está vazio.');
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) throw new ErroImportacao('O arquivo excede o tamanho máximo de 5 MB.');
};

export const lerPlanilhaExcel = async (conteudo: ArrayBuffer | Uint8Array) => {
  const { read, utils } = await carregarXlsx();
  let workbook;
  try {
    workbook = read(conteudo, { type: 'array' });
  } catch {
    throw new ErroImportacao('Não foi possível ler o arquivo. Verifique se é uma planilha Excel válida.');
  }
  const aba = workbook.SheetNames[0];
  const sheet = aba ? workbook.Sheets[aba] : undefined;
  if (!sheet || !sheet['!ref']) throw new ErroImportacao('A planilha está vazia.');
  const inicio = utils.decode_range(sheet['!ref']).s.r + 1;
  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true });
  return interpretarLinhas(rows, inicio);
};

export const baixarModeloImportacao = async () => {
  const { utils, writeFile } = await carregarXlsx();
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([COLUNAS_OBRIGATORIAS]), 'Produtos');
  writeFile(workbook, 'modelo-importacao-produtos.xlsx');
};

type OpcoesImportacao = {
  linhas: LinhaPlanilha[];
  itensAtuais: ItemProduto[];
  protocolo: string;
  consultar: (params: { item: string }) => Promise<unknown>;
  criarId: () => string;
  onProgresso?: (processadas: number, total: number) => void;
  concorrencia?: number;
};

export const importarProdutos = async ({
  linhas,
  itensAtuais,
  protocolo,
  consultar,
  criarId,
  onProgresso,
  concorrencia = 3
}: OpcoesImportacao) => {
  const resultados: ResultadoLinha[] = [];
  const linhaPorSerial = new Map<string, number>();
  const linhaPorUuid = new Map<string, number>();
  const pendentes = linhas.filter((linha) => {
    const serial = compactLookupValue(linha.serial);
    const uuid = compactLookupValue(linha.uuid);
    const anterior = linhaPorSerial.get(serial) ?? (uuid ? linhaPorUuid.get(uuid) : undefined);
    if (anterior !== undefined) {
      const campo = linhaPorSerial.has(serial) ? 'serial' : 'ID único';
      resultados.push({ ...linha, status: 'erro', mensagem: `Linha duplicada no arquivo (mesmo ${campo} da linha ${anterior}).` });
      return false;
    }
    linhaPorSerial.set(serial, linha.linha);
    if (uuid) linhaPorUuid.set(uuid, linha.linha);
    return true;
  });

  const consultados: { linha: LinhaPlanilha; produto: ProdutoApi }[] = [];
  let processadas = 0;
  let proxima = 0;
  onProgresso?.(0, pendentes.length);

  const worker = async () => {
    while (proxima < pendentes.length) {
      const linha = pendentes[proxima];
      proxima += 1;
      try {
        const produto = extrairProdutoApi(await consultar({ item: linha.codGemco || linha.uuid }));
        if (!produto.descricao) {
          resultados.push({ ...linha, status: 'erro', mensagem: `Produto não encontrado na API (${linha.codGemco ? `Gemco ${linha.codGemco}` : `ID único ${linha.uuid}`}).` });
        } else {
          consultados.push({ linha, produto });
        }
      } catch (error) {
        const detalhe = error instanceof Error && error.message ? ` ${error.message}` : '';
        resultados.push({ ...linha, status: 'erro', mensagem: `Falha ao consultar a API.${detalhe}` });
      } finally {
        processadas += 1;
        onProgresso?.(processadas, pendentes.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, pendentes.length)) }, worker));

  const itens = [...itensAtuais];
  const posicaoPorChave = new Map(itens.map((item, index) => [chaveProduto(item), index]));
  consultados
    .sort((a, b) => a.linha.linha - b.linha.linha)
    .forEach(({ linha, produto }) => {
      const codGemco = linha.codGemco || compactLookupValue(produto.codGemco);
      const dados = {
        uuid: linha.uuid || produto.uuid.replace(/\D/g, '') || '-',
        ean: produto.ean || '-',
        codGemco,
        descricao: produto.descricao,
        fornecedor: produto.fornecedor || '-',
        linha: produto.linha || '-',
        serial: linha.serial
      };
      const chave = chaveProduto(dados);
      const posicao = posicaoPorChave.get(chave);
      // Mesmo serial + Gemco atualiza o proprio item; serial ou ID unico de outro item e erro.
      const repetido = motivoProdutoRepetido(dados, itens.filter((_, index) => index !== posicao));
      if (repetido) {
        resultados.push({ linha: linha.linha, serial: linha.serial, codGemco, status: 'erro', mensagem: repetido });
      } else if (posicao !== undefined) {
        itens[posicao] = { ...itens[posicao], ...dados };
        resultados.push({ linha: linha.linha, serial: linha.serial, codGemco, status: 'atualizado', mensagem: 'Produto já existia no protocolo e foi atualizado.' });
      } else {
        posicaoPorChave.set(chave, itens.length);
        itens.push({ id: criarId(), protocolo, status: 0, ...dados });
        resultados.push({ linha: linha.linha, serial: linha.serial, codGemco, status: 'importado', mensagem: 'Produto importado.' });
      }
    });

  resultados.sort((a, b) => a.linha - b.linha);
  return { itens, resultados };
};
