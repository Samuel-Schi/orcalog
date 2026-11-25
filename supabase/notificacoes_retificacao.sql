-- 25/11: avisa o posto (sino) quando o AT retifica itens do orçamento.
-- Executar depois de notificacoes_pa.sql e da migração de retificação do AT. Pode ser reexecutado.
-- Um aviso por protocolo enquanto não for lido (a retificação de vários itens não gera vários avisos).
begin;
create or replace function public.registrar_aviso_retificacao_pa()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cnpj_pa text := regexp_replace(coalesce(new.cnpj, ''), '[^0-9]', '', 'g');
begin
  if new.retificacao is null or new.retificacao is not distinct from old.retificacao then return new; end if;
  if exists (select 1 from public.notificacoes_pa n
             where n.cnpj = cnpj_pa and n.protocolo = new.protocolo
               and n.tipo = 'RETIFICACAO' and n.lida_em is null) then
    return new;
  end if;
  insert into public.notificacoes_pa(cnpj, protocolo, tipo, mensagem)
  values (cnpj_pa, new.protocolo, 'RETIFICACAO', 'O AT retificou itens deste orçamento. Confira o retorno.');
  return new;
end;
$$;
drop trigger if exists aviso_retificacao_pa on public.orcamentos_finalizados;
create trigger aviso_retificacao_pa after update of retificacao on public.orcamentos_finalizados
for each row execute function public.registrar_aviso_retificacao_pa();
revoke all on function public.registrar_aviso_retificacao_pa() from public;
commit;
