export type CatalogoLinha = {
  PECAS: string[];
  ACESSORIOS?: string[];
  DEFEITOS: string[];
  SERVICOS?: string[];
};

const defeitosPadrao = [
  'DANIFICADO',
  'TRINCADO',
  'ARRANHADO / RISCADO',
  'DESCOLANDO',
  'COM LINHA',
  'NAO LIGA',
  'SEM FUNCIONAMENTO',
  'INTERMITENTE',
  'SUPERAQUECIMENTO',
  'BLOQUEADO',
  'SUJO',
  'AUSENTE',
  'SEM DEFEITO FUNCIONAL'
];

const servicosPadrao = [
  'ATUALIZACAO DE SOFTWARE',
  'RESTAURACAO DE SOFTWARE',
  'DESBLOQUEIO CONTA GOOGLE',
  'REPARO EM PLACA',
  'REMONTAGEM',
  'HIGIENIZACAO',
  'TROCA DA UNIDADE COMPLETA'
];

const catalogoInformaticaTabletPecas = [
  'BATERIA',
  'PLACA MAE',
  'SUB PLACA',
  'PLACA WI-FI',
  'TELA / DISPLAY',
  'SSD',
  'DISCO RIGIDO',
  'TECLADO',
  'TOUCHPAD',
  'CARTUCHO DE TINTA PRETO',
  'CARTUCHO DE TINTA COLORIDO',
  'COMBO TECLADO E MOUSE',
  'GABINETE COMPLETO',
  'TAMPA A (TAMPA SUPERIOR DO LCD)',
  'TAMPA B (MOLDURA DO LCD)',
  'TAMPA C (FACE DO TECLADO)',
  'TAMPA D (BASE INFERIOR)',
  'TAMPA TRASEIRA',
  'FONTE / CARREGADOR',
  'CABO USB',
  'CABO FLAT',
  'ADESIVO / FITA',
  'BORRACHA',
  'COLA',
  'GARANTIA PURA',
  'CABO DE FORCA',
  'CARCACA COMPLETA / GABINETE',
  'ATUALIZACAO DE SOFTWARE',
  'SLOT',
  'TAMPA',
  'MANUAL',
  'CAMERA',
  'MOLDURA DA DOBRADICA',
  'FITA / ADESIVO',
  'MEMORIA RAM',
  'TAMPA SUPERIOR',
  'CABO',
  'TAMPA INFERIOR',
  'MOLDURA DO DISPLAY',
  'SEM PECAS',
  'CABO HDMI',
  'CARCACA',
  'BOTAO DO TOUCHPAD',
  'CARCACA INFERIOR',
  'BASE DO MONITOR / SUPORTE',
  'VENTOINHA / COOLER',
  'DOBRADICA',
  'KIT DE REPARO',
  'DESBLOQUEIO / RETIRADA DE SENHA',
  'BLOQUEIO DE CONTA GOOGLE',
  'KIT DE PARAFUSOS',
  'TAMPA DA DOBRADICA',
  'BASE',
  'TOP CASE COM BATERIA',
  'TOUCH ID',
  'SUBCONJUNTO BASE',
  'CARCACA FRONTAL',
  'PLACA DE REDE',
  'PLACA DE CIRCUITO',
  'ADAPTADOR AC/DC',
  'ADESIVO',
  'CARREGADOR',
  'CONJUNTO DO DISPLAY',
  'CONJUNTO FRONTAL',
  'CONJUNTO FRONTAL LCD + TOUCH',
  'CONJUNTO TAMPA DA BATERIA',
  'CONJUNTO TAMPA TRASEIRA',
  'DISPLAY',
  'FONTE DE ALIMENTACAO',
  'LCD',
  'MOLDURA DA TELA',
  'PAINEL',
  'PLACA PRINCIPAL',
  'PLM',
  'TAMPA A',
  'TAMPA C',
  'TAMPA D',
  'TELA',
  'TELA AMOLED',
  'TECLADO COM CASE',
  'CABO FLEX',
  'FITA',
  'SUPORTE',
  'UB',
  'CABO DE DADOS USB',
  'MODULO DE INTERFACE DE REDE',
  'SSD BOARD',
  'TROCA DA GAVETA',
  'ACESSORIOS',
  'ALTO-FALANTE',
  'CASE',
  'CONJUNTO COMPLETO',
  'GABINETE FRONTAL',
  'MODULO DISPLAY',
  'WEBCAM'
];

const catalogoAquecedorEletroPecas = [
  'SUPORTE',
  'MANUAL',
  'CUBA',
  'MOTOR',
  'BOMBA DE DRENAGEM',
  'RESISTENCIA',
  'CORDAO',
  'CABO',
  'COBERTURA PLASTICA',
  'BOTAO',
  'FUNDO PLASTICO',
  'GRADE FRONTAL',
  'SUPORTE DO MOTOR',
  'SOBRECAPA FRONTAL',
  'BASE PLASTICA',
  'GABINETE',
  'BASE',
  'CORPO',
  'HELICE',
  'CESTO',
  'COPO',
  'COLUNA',
  'FUNDO',
  'TAMPA',
  'JARRA',
  'RESERVATORIO',
  'GRADE TRASEIRA',
  'TIGELA',
  'DEPOSITO',
  'TAMPA TRASEIRA',
  'BASE REMOVIVEL',
  'PORTA CAPSULA',
  'DEFLETOR',
  'TAMPA FRONTAL',
  'VENTILADOR MONDIAL',
  'GRELHA',
  'HASTE',
  'TAMPA DO COPO',
  'PUXADOR',
  'PEDESTAL',
  'TAMPA DA JARRA',
  'ALETA',
  'CONTROLE',
  'GABINETE FRONTAL',
  'COBERTURA',
  'COBERTURA SUPERIOR',
  'RODIZIO',
  'SOBRECAPA TRASEIRA',
  'CABO DE FORCA',
  'PORTA',
  'PAINEL',
  'DOSADOR',
  'DIFUSOR',
  'BOTAO (KNOB)',
  'SUPORTE DA LAMINA',
  'GABINETE INFERIOR',
  'COBERTURA INFERIOR',
  'SOBRETAMPA',
  'ARO',
  'TRAVA',
  'ALCA',
  'BATEDOR PESADO',
  'BATEDOR LEVE',
  'CONE',
  'TANQUE',
  'COBERTURA EXTERNA',
  'GABINETE SUPERIOR',
  'TAMPA DO DRENO',
  'VISOR',
  'GRADE',
  'PRODUTO USADO',
  'HIGIENIZACAO',
  'EMBALAGEM',
  'TROCA DE PROCEL',
  'HELICE PLASTICA',
  'HASTE PLASTICA',
  'TAMPA SUPERIOR',
  'GABINETE TRASEIRO',
  'GABINETE LATERAL',
  'GARANTIA PURA',
  'FILTRO',
  'PORTA FILTRO',
  'CAPA',
  'BATERIA',
  'BASE DE CARREGAMENTO',
  'SOBRECAPA',
  'VEDACAO',
  'VALVULA',
  'CHAPA',
  'TAMPA DO CESTO',
  'LAMINA DE RALAR',
  'BATEDOR',
  'RESERVATORIO DE PO',
  'CONTROLE REMOTO',
  'CORREIA',
  'MOTOR DE INDUCAO',
  'COBERTURA PLASTICA SUPERIOR',
  'COBERTURA PLASTICA LATERAL',
  'GABINETE PLASTICO INFERIOR',
  'ALCA PLASTICA LADO DIREITO',
  'GABINETE SUPERIOR PLASTICO',
  'PORTA COPO',
  'TAMPA INFERIOR',
  'CARCACA',
  'CORPO COMPLETO',
  'BANDEJA',
  'CARCACA COMPLETA',
  'CARCACA SUPERIOR',
  'CARCACA INFERIOR',
  'PORCA',
  'PLACA PLASTICA',
  'FERRO DA BASE',
  'CARCACA LATERAL',
  'KIT DE PES DE BORRACHA',
  'CONJUNTO DO TANQUE DE AGUA',
  'CONJUNTO DA TAMPA SUPERIOR',
  'CONJUNTO DA FACA / LAMINA',
  'CONJUNTO DA TAMPA',
  'ACABAMENTO INOX SUPERIOR',
  'GABINETE PLASTICO',
  'ALCA PLASTICA DA PORTA',
  'RODIZIO FRONTAL',
  'ACESSORIO DE PISO',
  'ALETA HORIZONTAL',
  'DISCO DE LAMINAS',
  'CABO DE FORCA (A/C)',
  'TROCA DE PECAS FALTANTES E QUEBRADAS',
  'TAPETE',
  'BASE CARREGADORA',
  'ELETROPORTATEIS',
  'LAMINA',
  'COPO DO PROCESSADOR',
  'CESTA',
  'FACA / LAMINA',
  'FUNCOES INOPERANTES',
  'CORPO EXTERNO',
  'CANOPLA',
  'MANGUEIRA',
  'TREMPE',
  'QUEIMADOR',
  'COBERTURA ESQUERDA',
  'GRADE LATERAL',
  'TAMPA DO RESERVATORIO',
  'SAIA PLASTICA',
  'SUPORTE DA CAPSULA',
  'PE',
  'CONJUNTO DE RODAS',
  'PLACA',
  'PLACA DE POTENCIA',
  'CORPO TRASEIRO',
  'CHAVE',
  'ESCOVAS',
  'BATEDORES',
  'ALCA DIREITA',
  'HASTE DE ACO'
];

export const catalogoPadrao: Record<string, CatalogoLinha> = {
  'TE - TELEFONIA': {
    PECAS: [
      'BATERIA',
      'TELA / DISPLAY',
      'TOUCH',
      'PLACA PRINCIPAL',
      'PLACA SUB / CARGA',
      'CONECTOR DE CARGA',
      'CAMERA',
      'LENTE DA CAMERA',
      'CARCACA / GABINETE',
      'TAMPA TRASEIRA',
      'GAVETA CHIP / SIM',
      'BOTAO / TECLA',
      'ALTO-FALANTE / SPEAKER',
      'RECEPTOR DE CHAMADA',
      'MOTOR VIBRATORIO',
      'ANTENA / NFC',
      'SENSOR BIOMETRICO',
      'CABO / FLEX',
      'FONTE / CARREGADOR'
    ],
    ACESSORIOS: ['CARREGADOR', 'CABO USB', 'FONE', 'CAPA', 'PELICULA', 'CHAVE CHIP', 'OUTRO ACESSORIO'],
    DEFEITOS: defeitosPadrao,
    SERVICOS: servicosPadrao
  },
  'IN - INFORMATICA': {
    PECAS: catalogoInformaticaTabletPecas,
    ACESSORIOS: ['FONTE / CARREGADOR', 'CARREGADOR', 'CABO USB', 'CABO DE FORCA', 'MANUAL', 'ACESSORIOS'],
    DEFEITOS: defeitosPadrao,
    SERVICOS: servicosPadrao
  },
  'TB - TABLET': {
    PECAS: catalogoInformaticaTabletPecas,
    ACESSORIOS: ['FONTE / CARREGADOR', 'CARREGADOR', 'CABO USB', 'CABO DE DADOS USB', 'MANUAL', 'ACESSORIOS'],
    DEFEITOS: defeitosPadrao,
    SERVICOS: servicosPadrao
  },
  'AV - AQUECEDOR E VENTILADOR': {
    PECAS: catalogoAquecedorEletroPecas,
    ACESSORIOS: ['MANUAL', 'CONTROLE REMOTO', 'CABO DE FORCA', 'BASE CARREGADORA', 'ACESSORIO DE PISO', 'ACESSORIOS'],
    DEFEITOS: defeitosPadrao,
    SERVICOS: servicosPadrao
  },
  'EP - ELETROPORTATEIS': {
    PECAS: catalogoAquecedorEletroPecas,
    ACESSORIOS: ['MANUAL', 'CONTROLE REMOTO', 'CABO DE FORCA', 'BASE CARREGADORA', 'ACESSORIO DE PISO', 'ACESSORIOS'],
    DEFEITOS: defeitosPadrao,
    SERVICOS: servicosPadrao
  }
};

const normalizeToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const getCatalogoByLinha = (linha?: string | null): CatalogoLinha | null => {
  const normalized = normalizeToken(linha || '');
  if (!normalized) return null;

  if (
    normalized === 'TE - TELEFONIA' ||
    normalized === 'TELEFONIA' ||
    normalized.startsWith('TE - TELEFON') ||
    normalized.includes('TELEFON')
  ) {
    return catalogoPadrao['TE - TELEFONIA'];
  }

  if (
    normalized === 'IN - INFORMATICA' ||
    normalized === 'INFORMATICA' ||
    normalized.startsWith('IN - INFORMAT') ||
    normalized.includes('INFORMAT')
  ) {
    return catalogoPadrao['IN - INFORMATICA'];
  }

  if (
    normalized === 'TB - TABLET' ||
    normalized === 'TABLET' ||
    normalized.startsWith('TB - TABLET') ||
    normalized.includes('TABLET')
  ) {
    return catalogoPadrao['TB - TABLET'];
  }

  if (
    normalized === 'AV - AQUECEDOR E VENTILADOR' ||
    normalized === 'AQUECEDOR E VENTILADOR' ||
    normalized.startsWith('AV - AQUECEDOR') ||
    normalized.includes('VENTILADOR')
  ) {
    return catalogoPadrao['AV - AQUECEDOR E VENTILADOR'];
  }

  if (
    normalized === 'EP - ELETROPORTATEIS' ||
    normalized === 'ELETROPORTATEIS' ||
    normalized.startsWith('EP - ELETROPORT') ||
    normalized.includes('ELETROPORT')
  ) {
    return catalogoPadrao['EP - ELETROPORTATEIS'];
  }

  return catalogoPadrao[normalized] || null;
};

export const appendCatalogValue = (current: string, next: string) => {
  const cleanedNext = next.trim();
  if (!cleanedNext) return current;

  const existing = current
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (existing.includes(cleanedNext)) return current;

  return [...existing, cleanedNext].join('; ');
};
