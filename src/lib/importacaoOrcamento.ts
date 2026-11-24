import {
  compactLookupValue,
  ErroImportacao,
  extrairProdutoApi,
  formatSerialValue,
  normalizarCabecalho,
  textoCelula,
  type ProdutoApi
} from './importacaoProdutos';
import { exigeFotoAvaria } from './avaria';

// SheetJS e carregado sob demanda para nao pesar no bundle principal.
const carregarXlsx = () => import('xlsx');

/*
 * Importacao do orcamento completo por planilha: uma linha por produto.
 * Pecas e acessorios vem numa celula ("Display: 300; Flex: 50") e sao
 * quebrados em itens; os demais valores tem coluna propria.
 */

export const LIMITE_ITENS_ORCAMENTO = 200;
const LINHAS_MODELO = 300;

type Campo =
  | 'serial'
  | 'notaFiscal'
  | 'codigo'
  | 'defeitoEncontrado'
  | 'defeitoFuncional'
  | 'garantia'
  | 'avariaEstetica'
  | 'tipoOrc'
  | 'pecas'
  | 'acessorios'
  | 'maoObra'
  | 'embalagem'
  | 'higienizacao';

type CampoItem = 'codigo' | 'defeitoEncontrado' | 'defeitoFuncional' | 'garantia' | 'tipoOrc';

const COLUNAS: Record<Campo, { rotulo: string; aliases: string[]; largura: number }> = {
  serial: { rotulo: 'Serial', aliases: ['numerodeserie', 'numeroserie', 'serialnumber', 'sn'], largura: 18 },
  notaFiscal: { rotulo: 'Nota fiscal', aliases: ['notafiscal', 'nf', 'nota', 'numeronf', 'numeronotafiscal', 'nfe'], largura: 18 },
  codigo: { rotulo: 'Gemco ou Código de barras', aliases: ['gemco', 'codgemco', 'codigogemco', 'ean', 'codigodebarras', 'codbarras'], largura: 24 },
  defeitoEncontrado: { rotulo: 'Defeito encontrado', aliases: ['defeito'], largura: 30 },
  defeitoFuncional: { rotulo: 'Defeito funcional (SIM/NAO)', aliases: ['defeitofuncional', 'possuidefeitofuncional'], largura: 24 },
  garantia: { rotulo: 'Garantia (SIM/NAO)', aliases: ['garantia', 'dentrodagarantia', 'dentrodoprazodegarantia'], largura: 18 },
  avariaEstetica: { rotulo: 'Avaria estética (SIM/NAO)', aliases: ['avariaestetica', 'avaria', 'possuiavariaestetica', 'temavariaestetica'], largura: 24 },
  tipoOrc: { rotulo: 'Tipo Orc.', aliases: ['tipoorcamento', 'tipodeorcamento'], largura: 12 },
  pecas: { rotulo: 'Peças (nome: valor; nome: valor)', aliases: ['pecas', 'peca'], largura: 40 },
  acessorios: { rotulo: 'Acessórios (nome: valor; nome: valor)', aliases: ['acessorios', 'acessorio'], largura: 34 },
  maoObra: { rotulo: 'Mão de obra (R$)', aliases: ['maodeobra', 'maoobra'], largura: 16 },
  embalagem: { rotulo: 'Embalagem (R$)', aliases: ['embalagem'], largura: 15 },
  higienizacao: { rotulo: 'Higienização (R$)', aliases: ['higienizacao'], largura: 16 }
};

const CAMPOS = Object.keys(COLUNAS) as Campo[];
// Avaria estetica e opcional no cabecalho: planilha antiga (sem a coluna) continua valendo e
// a avaria e deduzida pelo texto do defeito, como antes.
const CAMPOS_OBRIGATORIOS = CAMPOS.filter((campo) => campo !== 'avariaEstetica');
const CAMPOS_ITEM: CampoItem[] = ['codigo', 'defeitoEncontrado', 'defeitoFuncional', 'garantia', 'tipoOrc'];
const CAMPOS_TEXTO_MODELO: Campo[] = ['serial', 'notaFiscal', 'codigo'];

export const rotuloCampo = (campo: Campo) => COLUNAS[campo].rotulo;

const chaveOpcao = (valor: string) =>
  valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

const SIM_NAO: Record<string, string> = { SIM: 'SIM', S: 'SIM', NAO: 'NAO', N: 'NAO' };
export const TIPOS_ORC = ['SALDO A', 'NOVO', 'GARANTIA', 'SUCATA'];
const TIPO_ORC_POR_CHAVE = Object.fromEntries(TIPOS_ORC.map((tipo) => [chaveOpcao(tipo), tipo]));

export type ItemComValor = {
  nome: string;
  valor: number;
  /** Nome digitado, quando o portal trocou pelo padrao parecido do catalogo (permite desfazer). Nao vai no envio. */
  nomeOriginal?: string;
};

export type Pendencia = {
  campo: CampoItem | 'serial' | 'notaFiscal' | 'valores' | 'padrao' | 'avariaEstetica';
  mensagem: string;
  // Pendencia que bloqueia o envio; as demais sao apenas avisos.
  bloqueia: boolean;
  /** Descricao normalizada da peca sem padrao (campo 'padrao'). */
  peca?: string;
};

export type ItemOrcamentoPlanilha = {
  /** Vazio enquanto a peca sem serial nao recebeu o identificador (gerado no envio). */
  serial: string;
  /** true = peca sem Serial Number de fabrica; o serial e o identificador gerado pelo banco. */
  serialGerado?: boolean;
  /** Chave fixa do item no lote (liga o identificador gerado a este item, inclusive em "Tentar novamente"). */
  chaveItem?: string;
  notaFiscal: string;
  linha: number;
  codigo: string;
  defeitoEncontrado: string;
  defeitoFuncional: string;
  garantia: string;
  tipoOrc: string;
  pecas: ItemComValor[];
  acessorios: ItemComValor[];
  valPecas: number;
  valAcess: number;
  valMaoObra: number;
  valEmb: number;
  valHig: number;
  total: number;
  /** true = exige foto da avaria. */
  avaria: boolean;
  /** Coluna "Avaria estética": SIM = foto obrigatória (bloqueia o envio), NAO = foto opcional. Ausente = planilha antiga. */
  avariaEstetica?: 'SIM' | 'NAO';
  produto: ProdutoApi | null;
  pendencias: Pendencia[];
  /** Fotos e videos anexados na conferencia (vao para o Drive no envio). */
  evidencias?: File[];
  /** Pasta do Drive com as evidencias, depois de enviadas (reaproveitada em "Tentar novamente"). */
  linkDrive?: string;
  /** Pecas sem nada parecido no catalogo: vao com o nome original e geram pedido de padrao novo no envio. */
  pecasSemPadrao?: { chave: string; original: string; sugestao?: string }[];
  /** Pecas trocadas automaticamente pelo padrao parecido (desfeita = o posto voltou ao nome original). */
  pecasPadronizadas?: { chave: string; original: string; canonico: string; desfeita?: boolean }[];
};

export const AVISO_SEM_SERIAL = 'Sem serial: um SSAT-… é gerado no envio. Etiquete a peça.';

/** Chave fixa do item no lote; o identificador gerado para peca sem serial fica preso a ela. */
export const novaChaveItem = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Serial do produto para exibir: o identificador gerado ou o aviso de que sera gerado no envio. */
export const serialExibido = (item: Pick<ItemOrcamentoPlanilha, 'serial' | 'serialGerado'>) =>
  item.serial || (item.serialGerado ? 'Gerado no envio' : '');

export const AVISO_AVARIA_SEM_FOTO = 'Avaria sem foto: anexe em Evidências. Sem foto, vai como rascunho.';
export const AVISO_AVARIA_FOTO_OBRIGATORIA = 'Avaria estética: foto obrigatória. Anexe em Evidências.';

/** Pendencia de foto da avaria: obrigatoria (bloqueia) quando o posto marcou SIM; senao, so aviso (rascunho). */
const pendenciaFotoAvaria = (item: Pick<ItemOrcamentoPlanilha, 'avariaEstetica'>): Pendencia =>
  item.avariaEstetica === 'SIM'
    ? { campo: 'avariaEstetica', mensagem: AVISO_AVARIA_FOTO_OBRIGATORIA, bloqueia: true }
    : { campo: 'defeitoEncontrado', mensagem: AVISO_AVARIA_SEM_FOTO, bloqueia: false };

/** Troca as evidencias do item; a pendencia de foto da avaria some quando ha ao menos uma foto ou video. */
export const definirEvidencias = (item: ItemOrcamentoPlanilha, arquivos: File[]) => {
  item.evidencias = arquivos;
  item.linkDrive = undefined;
  item.pendencias = item.pendencias.filter((p) => p.mensagem !== AVISO_AVARIA_SEM_FOTO && p.mensagem !== AVISO_AVARIA_FOTO_OBRIGATORIA);
  if (item.avaria && !arquivos.length) item.pendencias.push(pendenciaFotoAvaria(item));
  return item;
};

export type ErroLinhaOrcamento = { linha: number; mensagem: string };
export type SerialRepetido = { serial: string; linhas: number[] };

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/** Valor monetario da planilha: numero do Excel ou texto como "R$ 1.234,56". NaN = invalido, null = em branco. */
export const lerValorMonetario = (raw: unknown): number | null => {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? centavos(raw) : NaN;
  const texto = String(raw ?? '').replace(/R\$|\s/gi, '');
  if (!texto) return null;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return NaN;
  return centavos(Number(normalizado));
};

// Separa os itens por ; | quebra de linha, ou por virgula seguida de letra
// ("Display: 300,00, Flex: 50"): a virgula decimal vem seguida de digito.
const SEPARADOR_ITENS = /[;|\n\r]+|,(?=\s*[^\d\s,])/;
// Sem ":" ou "=", o valor e o numero no fim: "Display 300", "Display - R$ 300,00".
const VALOR_NO_FIM = /^(.*?)[\s\-–]*(?:R\$\s*)?(\d[\d.,]*)\s*$/i;

/** Quebra "Display: 300; Flex: 50,00" em itens; `erros` lista as partes sem nome ou sem valor. */
export const quebrarItensComValor = (texto: string) => {
  const itens: ItemComValor[] = [];
  const erros: string[] = [];
  texto.split(SEPARADOR_ITENS).map((parte) => parte.trim()).filter(Boolean).forEach((parte) => {
    const separador = Math.max(parte.lastIndexOf(':'), parte.lastIndexOf('='));
    const noFim = separador < 0 ? parte.match(VALOR_NO_FIM) : null;
    const nome = (separador >= 0 ? parte.slice(0, separador) : noFim ? noFim[1] : parte).replace(/[\s\-–]+$/, '').trim();
    const valor = separador >= 0 ? lerValorMonetario(parte.slice(separador + 1)) : noFim ? lerValorMonetario(noFim[2]) : null;
    if (!nome) erros.push(`"${parte}" sem nome`);
    else if (valor === null) erros.push(`"${nome}" sem valor (use nome: valor)`);
    else if (Number.isNaN(valor)) erros.push(`"${parte}" com valor inválido`);
    else itens.push({ nome, valor });
  });
  return { itens, erros };
};

const mapearCabecalho = (row: unknown[]) => {
  const indices: Partial<Record<Campo, number>> = {};
  row.forEach((celula, index) => {
    const nome = normalizarCabecalho(celula);
    CAMPOS.forEach((campo) => {
      const aceitos = [normalizarCabecalho(COLUNAS[campo].rotulo), ...COLUNAS[campo].aliases];
      if (indices[campo] === undefined && aceitos.includes(nome)) indices[campo] = index;
    });
  });
  return indices;
};

// Normaliza o valor de um campo do item; `invalido` traz a mensagem quando o valor nao e aceito.
const normalizarCampoItem = (campo: CampoItem, texto: string): { valor: string; invalido?: string } => {
  if (campo === 'codigo') return { valor: compactLookupValue(texto) };
  if (campo === 'defeitoFuncional' || campo === 'garantia') {
    const valor = SIM_NAO[chaveOpcao(texto)];
    return valor ? { valor } : { valor: texto.toUpperCase(), invalido: `"${texto}" não é aceito: use SIM ou NAO.` };
  }
  if (campo === 'tipoOrc') {
    const valor = TIPO_ORC_POR_CHAVE[chaveOpcao(texto)];
    return valor ? { valor } : { valor: texto.toUpperCase(), invalido: `"${texto}" não é aceito: use ${TIPOS_ORC.join(', ')}.` };
  }
  return { valor: texto };
};

/**
 * Le uma linha por produto e aponta tudo que ficou em branco ou invalido.
 * `primeiraLinha` e o numero da linha do Excel correspondente a rows[0].
 */
export const interpretarPlanilhaOrcamento = (rows: unknown[][], primeiraLinha = 1) => {
  let melhor = { posicao: -1, indices: {} as Partial<Record<Campo, number>> };
  for (let posicao = 0; posicao < Math.min(rows.length, 10); posicao += 1) {
    const indices = mapearCabecalho(rows[posicao] || []);
    if (Object.keys(indices).length > Object.keys(melhor.indices).length) melhor = { posicao, indices };
    if (Object.keys(indices).length === CAMPOS.length) break;
  }

  const faltando = CAMPOS_OBRIGATORIOS.filter((campo) => melhor.indices[campo] === undefined);
  if (faltando.length) {
    throw new ErroImportacao(`Coluna(s) não encontrada(s): ${faltando.map(rotuloCampo).join(', ')}. Baixe o modelo e preencha sem alterar o cabeçalho.`);
  }

  const itens: ItemOrcamentoPlanilha[] = [];
  const errosLinha: ErroLinhaOrcamento[] = [];
  const corpo = rows.slice(melhor.posicao + 1);
  const numeroLinha = (index: number) => primeiraLinha + melhor.posicao + 1 + index;
  const celulaTexto = (row: unknown[] | undefined, campo: Campo) =>
    melhor.indices[campo] === undefined ? '' : textoCelula((row || [])[melhor.indices[campo] as number]);
  const temColunaAvaria = melhor.indices.avariaEstetica !== undefined;

  // Duplicidade so dentro da planilha: o mesmo serial nao pode aparecer duas vezes no arquivo.
  // TODAS as ocorrencias ficam de fora (nao da para saber qual linha e a certa).
  const linhasPorSerial = new Map<string, number[]>();
  corpo.forEach((row, index) => {
    const serial = formatSerialValue(celulaTexto(row, 'serial'));
    if (!serial) return;
    const chave = compactLookupValue(serial);
    linhasPorSerial.set(chave, [...(linhasPorSerial.get(chave) || []), numeroLinha(index)]);
  });
  const seriaisRepetidos: SerialRepetido[] = [];

  corpo.forEach((row, index) => {
    const linha = numeroLinha(index);
    const bruto = (campo: Campo) => (row || [])[melhor.indices[campo] as number];
    const texto = (campo: Campo) => celulaTexto(row, campo);
    if (CAMPOS.every((campo) => !texto(campo))) return;

    // Serial em branco = peca sem Serial Number: recebe um identificador unico no envio do lote.
    const serial = formatSerialValue(texto('serial'));
    const linhasDoSerial = serial ? linhasPorSerial.get(compactLookupValue(serial)) || [] : [];
    if (linhasDoSerial.length > 1) {
      if (linhasDoSerial[0] === linha) seriaisRepetidos.push({ serial, linhas: linhasDoSerial });
      errosLinha.push({ linha, mensagem: `Serial ${serial} repetido nas linhas ${linhasDoSerial.join(', ')}. Cada serial só pode aparecer uma vez na planilha.` });
      return;
    }

    const pendencias: Pendencia[] = [];
    if (!serial) pendencias.push({ campo: 'serial', mensagem: AVISO_SEM_SERIAL, bloqueia: false });
    const campos = {} as Record<CampoItem, string>;
    CAMPOS_ITEM.forEach((campo) => {
      const valorTexto = texto(campo);
      const { valor, invalido } = valorTexto ? normalizarCampoItem(campo, valorTexto) : { valor: '' };
      campos[campo] = valor;
      if (!valor) pendencias.push({ campo, mensagem: `${rotuloCampo(campo)} em branco.`, bloqueia: true });
      else if (invalido) pendencias.push({ campo, mensagem: invalido, bloqueia: true });
    });

    const notaFiscal = texto('notaFiscal');
    if (!notaFiscal) pendencias.push({ campo: 'notaFiscal', mensagem: 'Nota fiscal em branco.', bloqueia: true });

    const pecas = quebrarItensComValor(texto('pecas'));
    const acessorios = quebrarItensComValor(texto('acessorios'));
    if (pecas.erros.length) pendencias.push({ campo: 'valores', mensagem: `Peças: ${pecas.erros.join('; ')}.`, bloqueia: true });
    if (acessorios.erros.length) pendencias.push({ campo: 'valores', mensagem: `Acessórios: ${acessorios.erros.join('; ')}.`, bloqueia: true });

    // Mao de obra, embalagem e higienizacao em branco valem zero.
    const valorColuna = (campo: 'maoObra' | 'embalagem' | 'higienizacao') => {
      const valor = lerValorMonetario(bruto(campo));
      if (valor === null) return 0;
      if (Number.isNaN(valor)) {
        pendencias.push({ campo: 'valores', mensagem: `${rotuloCampo(campo)}: "${texto(campo)}" inválido.`, bloqueia: true });
        return 0;
      }
      return valor;
    };

    const valPecas = centavos(pecas.itens.reduce((soma, peca) => soma + peca.valor, 0));
    const valAcess = centavos(acessorios.itens.reduce((soma, acessorio) => soma + acessorio.valor, 0));
    const valMaoObra = valorColuna('maoObra');
    const valEmb = valorColuna('embalagem');
    const valHig = valorColuna('higienizacao');
    const total = centavos(valPecas + valAcess + valMaoObra + valEmb + valHig);
    // Com a coluna "Avaria estética", vale o que o posto marcou: SIM = foto obrigatoria, NAO = opcional.
    // Sem a coluna (planilha antiga), a avaria e deduzida pelo defeito e a falta de foto so vira rascunho.
    let avariaEstetica: 'SIM' | 'NAO' | undefined;
    if (temColunaAvaria) {
      const textoAvaria = texto('avariaEstetica');
      const valor = SIM_NAO[chaveOpcao(textoAvaria)] as 'SIM' | 'NAO' | undefined;
      if (valor) avariaEstetica = valor;
      else pendencias.push({ campo: 'avariaEstetica', bloqueia: true,
        mensagem: textoAvaria ? `Avaria estética "${textoAvaria}" não é aceita: use SIM ou NAO.` : 'Avaria estética em branco: use SIM ou NAO.' });
    }
    const avaria = temColunaAvaria ? avariaEstetica === 'SIM' : exigeFotoAvaria(campos.defeitoEncontrado);

    if (!total && !pendencias.some((p) => p.campo === 'valores')) {
      pendencias.push({ campo: 'valores', mensagem: 'Sem valores: total R$ 0,00.', bloqueia: false });
    }
    if (avaria) pendencias.push(pendenciaFotoAvaria({ avariaEstetica }));

    itens.push({
      serial,
      ...(serial ? {} : { serialGerado: true }),
      chaveItem: novaChaveItem(),
      notaFiscal,
      linha,
      ...campos,
      pecas: pecas.itens,
      acessorios: acessorios.itens,
      valPecas,
      valAcess,
      valMaoObra,
      valEmb,
      valHig,
      total,
      avaria,
      ...(avariaEstetica ? { avariaEstetica } : {}),
      produto: null,
      pendencias
    });
  });

  if (!itens.length && !errosLinha.length) throw new ErroImportacao('A planilha não possui linhas preenchidas abaixo do cabeçalho.');
  if (itens.length > LIMITE_ITENS_ORCAMENTO) {
    throw new ErroImportacao(`A planilha tem ${itens.length} produtos; o limite é ${LIMITE_ITENS_ORCAMENTO} por lote. Divida em mais de uma planilha.`);
  }
  return { itens, errosLinha, seriaisRepetidos };
};

export type CampoOrcamento = Campo;
export type ValoresManuais = Partial<Record<Campo, string | number>>;

/**
 * Lancamento manual: interpreta UM produto digitado com exatamente as mesmas regras da planilha
 * (mesmas colunas, obrigatorios e formatos). `erro` vem quando a linha nem pode ser lida (ex.: serial em branco).
 */
export const interpretarItemManual = (valores: ValoresManuais, linha = 1): { item?: ItemOrcamentoPlanilha; erro?: string } => {
  try {
    const { itens, errosLinha } = interpretarPlanilhaOrcamento([CAMPOS.map(rotuloCampo), CAMPOS.map((campo) => valores[campo] ?? '')], linha - 1);
    if (errosLinha.length) return { erro: errosLinha[0].mensagem };
    return { item: itens[0] };
  } catch (error) {
    if (error instanceof ErroImportacao) return { erro: 'Preencha os dados do produto.' };
    throw error;
  }
};

export const lerPlanilhaOrcamento = async (conteudo: ArrayBuffer | Uint8Array) => {
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
  return interpretarPlanilhaOrcamento(rows, inicio);
};

export const baixarModeloOrcamento = async () => {
  const { utils, writeFile } = await carregarXlsx();
  const workbook = utils.book_new();

  const sheet = utils.aoa_to_sheet([CAMPOS.map(rotuloCampo)]);
  sheet['!cols'] = CAMPOS.map((campo) => ({ wch: COLUNAS[campo].largura }));
  // Serial e codigos como texto: evita o Excel trocar EAN por 7,89E+12 e cortar zeros a esquerda.
  CAMPOS_TEXTO_MODELO.forEach((campo) => {
    const coluna = CAMPOS.indexOf(campo);
    for (let linha = 1; linha <= LINHAS_MODELO; linha += 1) {
      sheet[utils.encode_cell({ r: linha, c: coluna })] = { t: 's', v: '', z: '@' };
    }
  });
  sheet['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: LINHAS_MODELO, c: CAMPOS.length - 1 } });
  utils.book_append_sheet(workbook, sheet, 'Orçamento');

  const instrucoes = utils.aoa_to_sheet([
    ['Como preencher'],
    ['Uma linha por produto. O mesmo serial não pode aparecer em duas linhas.'],
    ['Peça sem Serial Number: deixe o Serial em branco. O portal gera um identificador único no envio (SSAT-...).'],
    ['Peças e acessórios: nome e valor (Display: 300), cada item separado por ponto e vírgula. Também aceita "Display 300" e itens em linhas separadas na célula.'],
    ['Mão de obra, embalagem e higienização: só o valor. Em branco vale zero.'],
    ['Não altere o cabeçalho da aba Orçamento.'],
    ['Nota fiscal é obrigatória em todas as linhas (identifica o item).'],
    ['Avaria estética: SIM = foto da avaria obrigatória (o lote não é enviado sem ela). NAO = foto opcional.'],
    [],
    ['Campo', 'Valores aceitos'],
    [rotuloCampo('notaFiscal'), 'Número da nota fiscal (texto). Obrigatório.'],
    [rotuloCampo('defeitoFuncional'), 'SIM ou NAO'],
    [rotuloCampo('garantia'), 'SIM ou NAO'],
    [rotuloCampo('avariaEstetica'), 'SIM (foto obrigatória) ou NAO (foto opcional)'],
    [rotuloCampo('tipoOrc'), TIPOS_ORC.join(', ')],
    [rotuloCampo('pecas'), 'Display: 300,00; Flex: 50'],
    [rotuloCampo('acessorios'), 'Controle remoto: 35'],
    [rotuloCampo('maoObra'), 'Número, ex.: 80,50'],
    [],
    ['Exemplo'],
    CAMPOS.map(rotuloCampo),
    ['ABC123456', '000123', '123456', 'Tela quebrada', 'SIM', 'NAO', 'SIM', 'NOVO', 'Display: 300; Flex: 50', '', 80, '', ''],
    ['XYZ987654', '000456', '7891234567890', 'Não liga', 'SIM', 'NAO', 'NAO', 'SALDO A', 'Placa principal: 120,50', 'Controle remoto: 35', 60, 10, 15]
  ]);
  instrucoes['!cols'] = [{ wch: 36 }, { wch: 60 }, ...CAMPOS.slice(2).map(() => ({ wch: 18 }))];
  utils.book_append_sheet(workbook, instrucoes, 'Instruções');

  writeFile(workbook, 'modelo-orcamento-posto.xlsx');
};

/** Planilha com os identificadores gerados no lote, para etiquetar as pecas sem serial. */
export const baixarIdentificadoresGerados = async (itens: ItemOrcamentoPlanilha[], protocolo: string) => {
  const gerados = itens.filter((item) => item.serialGerado && item.serial);
  if (!gerados.length) return;
  const { utils, writeFile } = await carregarXlsx();
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ['Protocolo', 'Linha da planilha', 'Identificador (serial)', 'Nota fiscal', 'Gemco / EAN', 'Produto'],
    ...gerados.map((item) => [protocolo, item.linha, item.serial, item.notaFiscal, item.codigo, item.produto?.descricao || ''])
  ]);
  sheet['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 40 }];
  utils.book_append_sheet(workbook, sheet, 'Identificadores');
  writeFile(workbook, `identificadores-${protocolo.replace(/[^A-Za-z0-9-]+/g, '_')}.xlsx`);
};

/** Completa descricao, fornecedor e linha pelo cadastro de produtos (Gemco ou EAN). */
export const consultarProdutosOrcamento = async (
  itens: ItemOrcamentoPlanilha[],
  consultar: (params: { item: string }) => Promise<unknown>,
  onProgresso?: (processados: number, total: number) => void,
  concorrencia = 3
) => {
  const pendentes = itens.filter((item) => item.codigo && !item.pendencias.some((p) => p.campo === 'codigo'));
  const cache = new Map<string, Promise<ProdutoApi>>();
  let processados = 0;
  let proximo = 0;
  onProgresso?.(0, pendentes.length);

  const worker = async () => {
    while (proximo < pendentes.length) {
      const item = pendentes[proximo];
      proximo += 1;
      try {
        if (!cache.has(item.codigo)) cache.set(item.codigo, consultar({ item: item.codigo }).then(extrairProdutoApi));
        const produto = await (cache.get(item.codigo) as Promise<ProdutoApi>);
        if (produto.descricao) item.produto = produto;
        else item.pendencias.push({ campo: 'codigo', mensagem: `Código ${item.codigo} não encontrado no cadastro de produtos.`, bloqueia: true });
      } catch {
        cache.delete(item.codigo);
        item.pendencias.push({ campo: 'codigo', mensagem: 'Falha ao consultar o produto. Envie a planilha de novo.', bloqueia: true });
      } finally {
        processados += 1;
        onProgresso?.(processados, pendentes.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, pendentes.length)) }, worker));
  return itens;
};

export const itemBloqueado = (item: ItemOrcamentoPlanilha) => item.pendencias.some((p) => p.bloqueia);

/** Seriais que aparecem mais de uma vez na lista (ja normalizados), com as posicoes (1 = primeiro item). */
export const seriaisDuplicados = (itens: Pick<ItemOrcamentoPlanilha, 'serial'>[]): SerialRepetido[] => {
  const posicoes = new Map<string, { serial: string; linhas: number[] }>();
  itens.forEach((item, indice) => {
    const chave = compactLookupValue(item.serial);
    if (!chave) return; // peca sem serial: o identificador ainda sera gerado
    const atual = posicoes.get(chave) || { serial: item.serial, linhas: [] };
    atual.linhas.push(indice + 1);
    posicoes.set(chave, atual);
  });
  return [...posicoes.values()].filter((p) => p.linhas.length > 1);
};

const ROTULO_INCONSISTENCIA: Record<Pendencia['campo'], string> = {
  serial: 'Serial', notaFiscal: 'Nota fiscal', codigo: 'Produto (Gemco / EAN)', defeitoEncontrado: 'Defeito encontrado',
  defeitoFuncional: 'Defeito funcional', garantia: 'Garantia', avariaEstetica: 'Avaria estética', tipoOrc: 'Tipo Orc.', valores: 'Peças e valores',
  padrao: 'Peça sem padrão no catálogo'
};

export type Inconsistencia = { titulo: string; linhas: number[]; detalhes: string[] };

/**
 * Tudo que impede o envio do lote, agrupado pelo que precisa ser corrigido (com as linhas da planilha).
 * Lista vazia = lote liberado para envio. Avisos (bloqueia: false) nao entram.
 */
export const inconsistenciasDoLote = (itens: ItemOrcamentoPlanilha[], errosLinha: ErroLinhaOrcamento[] = []): Inconsistencia[] => {
  const grupos = new Map<string, Inconsistencia>();
  const adicionar = (titulo: string, linha: number, detalhe: string) => {
    const grupo = grupos.get(titulo) || { titulo, linhas: [], detalhes: [] };
    if (!grupo.linhas.includes(linha)) grupo.linhas.push(linha);
    if (!grupo.detalhes.includes(detalhe)) grupo.detalhes.push(detalhe);
    grupos.set(titulo, grupo);
  };
  errosLinha.forEach((erro) => adicionar(/repetido/i.test(erro.mensagem) ? 'Serial repetido na planilha' : 'Linha não lida', erro.linha, erro.mensagem));
  itens.forEach((item) => item.pendencias.filter((p) => p.bloqueia).forEach((p) => adicionar(ROTULO_INCONSISTENCIA[p.campo], item.linha, p.mensagem)));
  return [...grupos.values()].map((g) => ({ ...g, linhas: g.linhas.sort((a, b) => a - b) }));
};

// Mesmo formato gravado por Lancar Orcamentos: "pe;nome1;nome2" sem acentos.
const selecaoCatalogo = (itens: ItemComValor[], prefixo: string) => {
  const nomes = itens
    .map((item) => item.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim())
    .filter(Boolean);
  return nomes.length ? `${prefixo};${nomes.join(';')}` : '';
};

/** Dados de cadastro do produto, no formato de Novo Orcamento (registrar_lote_posto). */
export const montarItemCadastro = (item: ItemOrcamentoPlanilha, protocolo: string) => {
  const produto = item.produto;
  const ean = produto?.ean || '-';
  return {
    protocolo,
    uuid: produto?.uuid.replace(/\D/g, '') || '-',
    ean,
    codBarras: ean,
    codGemco: compactLookupValue(produto?.codGemco || '') || item.codigo,
    descricao: produto?.descricao || '',
    fornecedor: produto?.fornecedor || '-',
    linha: produto?.linha || '-',
    serial: item.serial,
    notaFiscal: item.notaFiscal,
    status: 0
  };
};

/** Valores do orcamento, nos mesmos campos enviados por Lancar Orcamentos. */
export const montarValoresOrcamento = (item: ItemOrcamentoPlanilha) => ({
  defeitoEncontrado: item.defeitoEncontrado,
  pecasDesc: selecaoCatalogo(item.pecas, 'pe'),
  pecasDetalhes: JSON.stringify(item.pecas.map(({ nome, valor }) => ({ nome, valor }))),
  valPecas: item.valPecas,
  acessDesc: selecaoCatalogo(item.acessorios, 'ac'),
  acessDetalhes: JSON.stringify(item.acessorios),
  valAcess: item.valAcess,
  valMaoObra: item.valMaoObra,
  valEmb: item.valEmb,
  valHig: item.valHig,
  totalOrcamento: item.total,
  defeitoFuncional: item.defeitoFuncional,
  garantia: item.garantia,
  tipoOrc: item.tipoOrc
});
