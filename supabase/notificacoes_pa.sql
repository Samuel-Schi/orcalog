-- Executar após orcamentos_finalizados_setup.sql e orcamento_negociacoes.sql.
-- Registra eventos futuros, inclusive quando o portal está fechado.
begin;
create table if not exists public.notificacoes_pa (
  id bigserial primary key,
  cnpj text not null,
  protocolo text not null,
  tipo text not null,
  mensagem text not null,
  criado_em timestamptz not null default now(),
  lida_em timestamptz
);
create index if not exists notificacoes_pa_cnpj_id_idx
  on public.notificacoes_pa (cnpj, id desc);
alter table public.notificacoes_pa enable row level security;
revoke all on public.notificacoes_pa from anon, authenticated;
grant select, insert, update on public.notificacoes_pa to service_role;
grant usage, select on sequence public.notificacoes_pa_id_seq to service_role;

create or replace function public.registrar_aviso_status_pa()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  novo jsonb := to_jsonb(new);
  anterior jsonb := to_jsonb(old);
  descricao text;
begin
  if novo->'status' is not distinct from anterior->'status'
     and novo->'status_text' is not distinct from anterior->'status_text' then
    return new;
  end if;
  descricao := coalesce(nullif(novo->>'status_text', ''), case new.status
    when 0 then 'Pendente' when 1 then 'Pendente' when 2 then 'Enviado'
    when 3 then 'Em análise' when 7 then 'Em negociação'
    when 8 then 'Montagem' when 4 then 'Finalizado' when 10 then 'Finalizado'
    else new.status::text end, 'Atualizado');
  insert into public.notificacoes_pa(cnpj, protocolo, tipo, mensagem)
  values (regexp_replace(new.cnpj, '[^0-9]', '', 'g'), new.protocolo, 'STATUS',
    'Item ' || new.oracle_item_id || ': ' || descricao);
  return new;
end;
$$;
drop trigger if exists aviso_status_pa on public.orcamentos_finalizados;
create trigger aviso_status_pa after update on public.orcamentos_finalizados
for each row execute function public.registrar_aviso_status_pa();

create or replace function public.registrar_aviso_negociacao_pa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if upper(coalesce(new.acao_pendente_de, '')) <> 'POSTO' then return new; end if;
  if tg_op = 'UPDATE' then
    if row(new.status, new.acao_pendente_de, new.valor_proposto_at, new.observacao_at, new.item_ids)
       is not distinct from
       row(old.status, old.acao_pendente_de, old.valor_proposto_at, old.observacao_at, old.item_ids)
    then return new; end if;
  end if;
  insert into public.notificacoes_pa(cnpj, protocolo, tipo, mensagem)
  values (regexp_replace(new.cnpj, '[^0-9]', '', 'g'), new.protocolo, 'NEGOCIACAO',
    'Há uma proposta de negociação aguardando sua resposta.');
  return new;
end;
$$;
drop trigger if exists aviso_negociacao_pa on public.orcamento_negociacoes;
create trigger aviso_negociacao_pa after insert or update on public.orcamento_negociacoes
for each row execute function public.registrar_aviso_negociacao_pa();
revoke all on function public.registrar_aviso_status_pa() from public;
revoke all on function public.registrar_aviso_negociacao_pa() from public;
commit;
