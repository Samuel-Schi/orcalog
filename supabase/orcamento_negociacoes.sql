create table if not exists public.orcamento_negociacoes (
  id bigserial primary key,
  protocolo text not null unique,
  cnpj text not null,
  pa_usuario text,
  negotiation_scope text not null default 'LOTE',
  item_ids jsonb not null default '[]'::jsonb,
  valor_original numeric(12,2),
  valor_proposto_at numeric(12,2),
  valor_contraproposta_posto numeric(12,2),
  observacao_at text,
  observacao_posto text,
  email_destino text,
  status text not null default 'ABERTA_AT',
  acao_pendente_de text not null default 'POSTO',
  criado_por text,
  respondido_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orcamento_negociacoes_cnpj
  on public.orcamento_negociacoes (cnpj);

create index if not exists idx_orcamento_negociacoes_status
  on public.orcamento_negociacoes (status, acao_pendente_de);
