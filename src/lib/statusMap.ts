export const STATUS_MAP = {
  1: 'Pendente orcamento',
  2: 'Orcamento enviado',
  3: 'Analise orcamento',
  4: 'Aprovacao'
} as const;

export type StatusCode = keyof typeof STATUS_MAP;

export const getStatusLabel = (code: number | string) => {
  const numeric = typeof code === 'string' ? Number(code) : code;
  return STATUS_MAP[numeric as StatusCode] ?? String(code);
};
