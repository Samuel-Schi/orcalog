-- Tabela principal
create table if not exists public.orcamentos_finalizados (
  id bigserial primary key,
  oracle_item_id bigint not null,
  protocolo text not null,
  pa_usuario text,
  cnpj text not null,
  razao_social text,
  unidade text,
  email_retorno text,
  uuid text,
  cod_barras text,
  ean text,
  cod_gemco text,
  descricao text,
  fornecedor text,
  linha text,
  serial text,
  defeito_encontrado text,
  foto_nome text,
  pecas_desc text,
  val_pecas numeric(12,2) default 0,
  acess_desc text,
  val_acess numeric(12,2) default 0,
  val_mao_obra numeric(12,2) default 0,
  val_emb numeric(12,2) default 0,
  val_hig numeric(12,2) default 0,
  total_orcamento numeric(12,2) default 0,
  defeito_funcional text,
  garantia text,
  tipo_orc text,
  status integer default 1,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create unique index if not exists orcamentos_finalizados_oracle_item_id_idx
on public.orcamentos_finalizados (oracle_item_id);

create index if not exists orcamentos_finalizados_protocolo_idx
on public.orcamentos_finalizados (protocolo);

create index if not exists orcamentos_finalizados_cnpj_idx
on public.orcamentos_finalizados (cnpj);

create index if not exists orcamentos_finalizados_status_idx
on public.orcamentos_finalizados (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_orcamentos_finalizados_updated_at on public.orcamentos_finalizados;

create trigger trg_orcamentos_finalizados_updated_at
before update on public.orcamentos_finalizados
for each row
execute function public.set_updated_at();

-- Grants para API REST do Supabase
grant usage on schema public to service_role;
grant select, insert, update on table public.orcamentos_finalizados to service_role;
grant usage, select on sequence public.orcamentos_finalizados_id_seq to service_role;

-- Opcional: manter a tabela fora do acesso publico/anon
revoke all on table public.orcamentos_finalizados from anon;
revoke all on table public.orcamentos_finalizados from authenticated;

