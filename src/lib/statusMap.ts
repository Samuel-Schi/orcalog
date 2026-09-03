export const STATUS_MAP = {
  0: 'Pendente',
  1: 'Pendente',
  2: 'Enviado',
  3: 'Em analise',
  8: 'Montagem',
  7: 'Em negociacao',
  4: 'Aprovado',
  10: 'Aprovado'
} as const;

export type StatusCode = keyof typeof STATUS_MAP;

export const getStatusLabel = (code: number | string) => {
  const numeric = typeof code === 'string' ? Number(code) : code;
  return STATUS_MAP[numeric as StatusCode] ?? String(code);
};

export const isStatusFinalizado = (code: number | string) => {
  const numeric = typeof code === 'string' ? Number(code) : code;
  return numeric === 4 || numeric === 10;
};
