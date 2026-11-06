import {
  compactLookupValue,
  ErroImportacao,
  extrairProdutoApi,
  formatSerialValue,
  normalizarCabecalho,
  textoCelula,
  type ProdutoApi
} from './importacaoProdutos';

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
  tipoOrc: { rotulo: 'Tipo Orc.', aliases: ['tipoorcamento', 'tipodeorcamento'], largura: 12 },
  pecas: { rotulo: 'Peças (nome: valor; nome: valor)', aliases: ['pecas', 'peca'], largura: 40 },
  acessorios: { rotulo: 'Acessórios (nome: valor; nome: valor)', aliases: ['acessorios', 'acessorio'], largura: 34 },
  maoObra: { rotulo: 'Mão de obra (R$)', aliases: ['maodeobra', 'maoobra'], largura: 16 },
  embalagem: { rotulo: 'Embalagem (R$)', aliases: ['embalagem'], largura: 15 },
  higienizacao: { rotulo: 'Higienização (R$)', aliases: ['higienizacao'], largura: 16 }
};

const CAMPOS = Object.keys(COLUNAS) as Campo[];
const CAMPOS_ITEM: CampoItem[] = ['codigo', 'defeitoEncontrado', 'defeitoFuncional', 'garantia', 'tipoOrc'];
const CAMPOS_TEXTO_MODELO: Campo[] = ['serial', 'notaFiscal', 'codigo'];

export const rotuloCampo = (campo: Campo) => COLUNAS[campo].rotulo;

const chaveOpcao = (valor: string) =>
  valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

const SIM_NAO: Record<string, string> = { SIM: 'SIM', S: 'SIM', NAO: 'NAO', N: 'NAO' };
export const TIPOS_ORC = ['SALDO A', 'NOVO', 'GARANTIA', 'SUCATA'];
const TIPO_ORC_POR_CHAVE = Object.fromEntries(TIPOS_ORC.map((tipo) => [chaveOpcao(tipo), tipo]));

export type ItemComValor = { nome: string; valor: number };

export type Pendencia = {
  campo: CampoItem | 'serial' | 'notaFiscal' | 'valores';
  mensagem: string;
  // Pendencia que bloqueia o envio; as demais sao apenas avisos.
  bloqueia: boolean;
};

export type ItemOrcamentoPlanilha = {
  serial: string;
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
  avaria: boolean;
  produto: ProdutoApi | null;
  // Protocolo do lote aberto onde o serial ja foi enviado (duplicidade).
  loteAnterior?: string;
  pendencias: Pendencia[];
};

export type ErroLinhaOrcamento = { linha: number; mensagem: string };

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

  const faltando = CAMPOS.filter((campo) => melhor.indices[campo] === undefined);
  if (faltando.length) {
    throw new ErroImportacao(`Coluna(s) não encontrada(s): ${faltando.map(rotuloCampo).join(', ')}. Baixe o modelo e preencha sem alterar o cabeçalho.`);
  }

  const itens: ItemOrcamentoPlanilha[] = [];
  const linhaPorSerial = new Map<string, number>();
  const errosLinha: ErroLinhaOrcamento[] = [];

  rows.slice(melhor.posicao + 1).forEach((row, index) => {
    const linha = primeiraLinha + melhor.posicao + 1 + index;
    const bruto = (campo: Campo) => (row || [])[melhor.indices[campo] as number];
    const texto = (campo: Campo) => textoCelula(bruto(campo));
    if (CAMPOS.every((campo) => !texto(campo))) return;

    const serial = formatSerialValue(texto('serial'));
    if (!serial) {
      errosLinha.push({ linha, mensagem: 'Serial em branco.' });
      return;
    }
    const chave = compactLookupValue(serial);
    const anterior = linhaPorSerial.get(chave);
    if (anterior !== undefined) {
      errosLinha.push({ linha, mensagem: `Serial ${serial} repetido (já está na linha ${anterior}). Use uma linha por produto.` });
      return;
    }
    linhaPorSerial.set(chave, linha);

    const pendencias: Pendencia[] = [];
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
    const avaria = /AVARIA/i.test(campos.defeitoEncontrado);

    if (!total && !pendencias.some((p) => p.campo === 'valores')) {
      pendencias.push({ campo: 'valores', mensagem: 'Nenhum valor informado: o orçamento vai com total R$ 0,00.', bloqueia: false });
    }
    if (avaria) {
      pendencias.push({
        campo: 'defeitoEncontrado',
        mensagem: 'Avaria exige foto: o item entra no lote como rascunho e precisa da foto em Lançar Orçamentos antes de finalizar.',
        bloqueia: false
      });
    }

    itens.push({
      serial,
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
      produto: null,
      pendencias
    });
  });

  if (!itens.length && !errosLinha.length) throw new ErroImportacao('A planilha não possui linhas preenchidas abaixo do cabeçalho.');
  if (itens.length > LIMITE_ITENS_ORCAMENTO) {
    throw new ErroImportacao(`A planilha tem ${itens.length} produtos; o limite é ${LIMITE_ITENS_ORCAMENTO} por lote. Divida em mais de uma planilha.`);
  }
  return { itens, errosLinha };
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
    ['Peças e acessórios: nome e valor (Display: 300), cada item separado por ponto e vírgula. Também aceita "Display 300" e itens em linhas separadas na célula.'],
    ['Mão de obra, embalagem e higienização: só o valor. Em branco vale zero.'],
    ['Não altere o cabeçalho da aba Orçamento.'],
    ['Nota fiscal é obrigatória em todas as linhas (identifica o item).'],
    [],
    ['Campo', 'Valores aceitos'],
    [rotuloCampo('notaFiscal'), 'Número da nota fiscal (texto). Obrigatório.'],
    [rotuloCampo('defeitoFuncional'), 'SIM ou NAO'],
    [rotuloCampo('garantia'), 'SIM ou NAO'],
    [rotuloCampo('tipoOrc'), TIPOS_ORC.join(', ')],
    [rotuloCampo('pecas'), 'Display: 300,00; Flex: 50'],
    [rotuloCampo('acessorios'), 'Controle remoto: 35'],
    [rotuloCampo('maoObra'), 'Número, ex.: 80,50'],
    [],
    ['Exemplo'],
    CAMPOS.map(rotuloCampo),
    ['ABC123456', '000123', '123456', 'Tela quebrada', 'SIM', 'NAO', 'NOVO', 'Display: 300; Flex: 50', '', 80, '', ''],
    ['XYZ987654', '000456', '7891234567890', 'Não liga', 'SIM', 'NAO', 'SALDO A', 'Placa principal: 120,50', 'Controle remoto: 35', 60, 10, 15]
  ]);
  instrucoes['!cols'] = [{ wch: 36 }, { wch: 60 }, ...CAMPOS.slice(2).map(() => ({ wch: 18 }))];
  utils.book_append_sheet(workbook, instrucoes, 'Instruções');

  writeFile(workbook, 'modelo-orcamento-posto.xlsx');
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

export type ItemJaEnviado = { serial?: unknown; protocolo?: unknown; status?: unknown; cancelamento?: unknown };

// Finalizado (4/10) ou cancelado libera o serial para um novo orcamento; qualquer outro estado e lote em aberto.
const loteEmAberto = (existente: ItemJaEnviado) =>
  !existente.cancelamento && ![4, 10].includes(Number(existente.status ?? 0));

/**
 * Bloqueia serial que ja esta em lote aberto do posto, para a mesma planilha nao virar dois lotes.
 * Itens do `protocoloAtual` sao ignorados: e o proprio lote sendo reenviado apos uma falha.
 * Retorna os seriais bloqueados.
 */
export const marcarSeriaisJaEnviados = (
  itens: ItemOrcamentoPlanilha[],
  existentes: ItemJaEnviado[],
  protocoloAtual: string
) => {
  const protocoloPorSerial = new Map<string, string>();
  existentes.forEach((existente) => {
    const protocolo = String(existente.protocolo ?? '');
    const serial = compactLookupValue(String(existente.serial ?? ''));
    if (serial && protocolo !== protocoloAtual && loteEmAberto(existente)) protocoloPorSerial.set(serial, protocolo);
  });

  const bloqueados: string[] = [];
  itens.forEach((item) => {
    item.pendencias = item.pendencias.filter((p) => p.campo !== 'serial');
    const protocolo = protocoloPorSerial.get(compactLookupValue(item.serial));
    item.loteAnterior = protocolo;
    if (protocolo === undefined) return;
    bloqueados.push(item.serial);
    item.pendencias.unshift({
      campo: 'serial',
      mensagem: `DUPLICIDADE: este serial já foi enviado no lote ${protocolo || 'sem protocolo'}, que ainda está em aberto. Enviar de novo criaria o mesmo produto em dois lotes. Remova a linha da planilha ou cancele o item no lote ${protocolo || 'anterior'}.`,
      bloqueia: true
    });
  });
  return bloqueados;
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
  pecasDetalhes: JSON.stringify(item.pecas),
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
