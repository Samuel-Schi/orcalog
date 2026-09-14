create table if not exists public.orcamento_rascunhos (
  id bigserial primary key,
  pa_usuario text not null,
  cnpj text,
  protocolo text,
  status text not null default 'RASCUNHO',
  payload jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists orcamento_rascunhos_pa_usuario_idx
  on public.orcamento_rascunhos (pa_usuario);

create index if not exists orcamento_rascunhos_status_idx
  on public.orcamento_rascunhos (status);

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_orcamento_rascunhos_updated_at on public.orcamento_rascunhos;

create trigger trg_orcamento_rascunhos_updated_at
before update on public.orcamento_rascunhos
for each row
execute function public.set_current_timestamp_updated_at();

grant select, insert, update on table public.orcamento_rascunhos to service_role;
grant usage, select on sequence public.orcamento_rascunhos_id_seq to service_role;

revoke all on table public.orcamento_rascunhos from anon;
revoke all on table public.orcamento_rascunhos from authenticated;
