-- Execute este script no SQL Editor do Supabase antes de publicar a tela de pagamentos.
alter table public.orcamentos_finalizados
  add column if not exists pagamento_status text not null default 'AGUARDANDO_NOTA',
  add column if not exists pagamento_referencia text,
  add column if not exists nota_fiscal_nome text,
  add column if not exists nota_fiscal_drive_link text,
  add column if not exists nota_fiscal_enviada_em timestamptz,
  add column if not exists pagamento_solicitado_em timestamptz;

create index if not exists orcamentos_finalizados_pagamento_status_idx
  on public.orcamentos_finalizados (pagamento_status);

grant select, update on table public.orcamentos_finalizados to service_role;
