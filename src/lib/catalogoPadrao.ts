export type CatalogoLinha = {
  PECAS: string[];
  ACESSORIOS?: string[];
  DEFEITOS: string[];
  SERVICOS?: string[];
};

const normalizeToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const getCatalogoByLinha = (linha: string | null | undefined, catalogo: Record<string, CatalogoLinha>): CatalogoLinha | null => {
  const normalized = normalizeToken(linha || '');
  if (!normalized) return null;

  if (
    normalized === 'TE - TELEFONIA' ||
    normalized === 'TELEFONIA' ||
    normalized.startsWith('TE - TELEFON') ||
    normalized.includes('TELEFON')
  ) {
    return catalogo['TE - TELEFONIA'] || null;
  }

  if (
    normalized === 'IN - INFORMATICA' ||
    normalized === 'INFORMATICA' ||
    normalized.startsWith('IN - INFORMAT') ||
    normalized.includes('INFORMAT')
  ) {
    return catalogo['IN - INFORMATICA'] || null;
  }

  if (
    normalized === 'TB - TABLET' ||
    normalized === 'TABLET' ||
    normalized.startsWith('TB - TABLET') ||
    normalized.includes('TABLET')
  ) {
    return catalogo['TB - TABLET'] || null;
  }

  if (
    normalized === 'AV - AQUECEDOR E VENTILADOR' ||
    normalized === 'AQUECEDOR E VENTILADOR' ||
    normalized.startsWith('AV - AQUECEDOR') ||
    normalized.includes('VENTILADOR')
  ) {
    return catalogo['AV - AQUECEDOR E VENTILADOR'] || null;
  }

  if (
    normalized === 'EP - ELETROPORTATEIS' ||
    normalized === 'ELETROPORTATEIS' ||
    normalized.startsWith('EP - ELETROPORT') ||
    normalized.includes('ELETROPORT')
  ) {
    return catalogo['EP - ELETROPORTATEIS'] || null;
  }

  return catalogo[normalized] || null;
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

export type CatalogoRegistro = {
  linha: string;
  tipo: string;
  item: string;
  ativo: boolean;
};

export const agruparCatalogo = (registros: CatalogoRegistro[]): Record<string, CatalogoLinha> => {
  const catalogo: Record<string, CatalogoLinha> = {};
  const tipos: Record<string, keyof CatalogoLinha> = {
    PECA: 'PECAS', PECAS: 'PECAS', ACESSORIO: 'ACESSORIOS', ACESSORIOS: 'ACESSORIOS',
    DEFEITO: 'DEFEITOS', DEFEITOS: 'DEFEITOS', SERVICO: 'SERVICOS', SERVICOS: 'SERVICOS'
  };
  for (const registro of registros) {
    if (registro.ativo !== true) continue;
    const linha = normalizeToken(registro.linha || '');
    const tipo = tipos[normalizeToken(registro.tipo || '')];
    const item = (registro.item || '').trim();
    if (!linha || !tipo || !item) continue;
    const grupo = catalogo[linha] ||= { PECAS: [], ACESSORIOS: [], DEFEITOS: [], SERVICOS: [] };
    const itens = grupo[tipo] ||= [];
    if (!itens.includes(item)) itens.push(item);
  }
  return catalogo;
};

