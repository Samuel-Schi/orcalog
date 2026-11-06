-- Reduz consumo/crescimento no Supabase (logs de escrita + storage):
--  A) Notificacoes: refina o trigger (sem estados internos do posto) + retencao.
--  B) Rascunhos: purga os FINALIZADO (dados ja estao em orcamentos_finalizados).
-- Seguro: listar_orcamentos_posto ja exclui rascunho FINALIZADO e mostra o item pela tabela final.
-- Rode DEPOIS de notificacoes_pa.sql e orcamento_posto_supabase.sql.
begin;

-- A1) Trigger de status: so avisa o posto sobre progresso do lado da AT.
--     Pula 0/1 (Pendente) e 8 (Montagem) = acoes/edicao internas do proprio posto (fonte do spam).
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
  -- Nao notifica estados internos do posto; evita 1 insert por save de montagem.
  if new.status in (0, 1, 8) then
    return new;
  end if;
  descricao := coalesce(nullif(novo->>'status_text', ''), case new.status
    when 2 then 'Enviado'
    when 3 then 'Em análise' when 7 then 'Em negociação'
    when 4 then 'Finalizado' when 10 then 'Finalizado'
    else new.status::text end, 'Atualizado');
  insert into public.notificacoes_pa(cnpj, protocolo, tipo, mensagem)
  values (regexp_replace(new.cnpj, '[^0-9]', '', 'g'), new.protocolo, 'STATUS',
    'Item ' || new.oracle_item_id || ': ' || descricao);
  return new;
end;
$$;

-- A2)+B) Rotina unica de manutencao: retencao de notificacao + purga de rascunho finalizado.
create or replace function public.limpar_consumo_supabase()
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Notificacoes: lidas com +30 dias, e teto rigido de 90 dias para qualquer uma.
  delete from public.notificacoes_pa
   where (lida_em is not null and lida_em < now() - interval '30 days')
      or criado_em < now() - interval '90 days';
  -- Rascunhos ja finalizados (copia completa vive em orcamentos_finalizados).
  delete from public.orcamento_lancamento_rascunhos
   where status = 'FINALIZADO' and atualizado_em < now() - interval '7 days';
end;
$$;
revoke all on function public.limpar_consumo_supabase() from public, anon, authenticated;
grant execute on function public.limpar_consumo_supabase() to service_role;

-- B) Limpeza imediata do backlog atual (seguro, verificado):
delete from public.orcamento_lancamento_rascunhos where status = 'FINALIZADO';
-- A) Limpeza imediata de notificacoes antigas:
select public.limpar_consumo_supabase();

-- Automacao diaria (04:00) se o pg_cron estiver disponivel; senao, agende manualmente.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'limpar_consumo_supabase_diario') then
      perform cron.schedule('limpar_consumo_supabase_diario', '0 4 * * *',
        $cron$select public.limpar_consumo_supabase();$cron$);
    end if;
  else
    raise notice 'pg_cron nao instalado. Agende public.limpar_consumo_supabase() em Supabase > Database > Cron Jobs (ou via Netlify scheduled function).';
  end if;
end $$;

commit;
