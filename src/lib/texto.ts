// Bytes 0x80-0x9F no Windows-1252: quando UTF-8 e lido como 1252, viram estes caracteres.
const CP1252_PARA_BYTE: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
};

// Assinatura de UTF-8 lido como Latin-1/1252: "Ã§", "Ã£", "Ã‰", "Â°"...
const PARECE_QUEBRADO = /[Â-Ã][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/;

/** Desfaz texto UTF-8 que foi decodificado como Latin-1/Windows-1252 ("AÃ§o" -> "Aço"). Texto correto volta igual. */
export const corrigirTextoQuebrado = (texto: string) => {
  if (!PARECE_QUEBRADO.test(texto)) return texto;
  const bytes: number[] = [];
  for (const caractere of texto) {
    const codigo = caractere.charCodeAt(0);
    const byte = codigo <= 0xFF ? codigo : CP1252_PARA_BYTE[caractere];
    if (byte === undefined) return texto;
    bytes.push(byte);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return texto;
  }
};

/** Aplica corrigirTextoQuebrado em todas as strings de um JSON (objetos e listas). */
export const corrigirTextosQuebrados = <T>(valor: T): T => {
  if (typeof valor === 'string') return corrigirTextoQuebrado(valor) as T;
  if (Array.isArray(valor)) return valor.map(corrigirTextosQuebrados) as T;
  if (valor && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, corrigirTextosQuebrados(item)])) as T;
  }
  return valor;
};

/** Decodifica bytes como UTF-8; se nao forem UTF-8 valido, como Windows-1252 (padrao de bancos Oracle antigos). */
export const decodificarBytes = (bytes: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};
