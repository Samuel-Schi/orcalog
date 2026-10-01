-- Executar no Supabase compartilhado pelos dois portais, antes do deploy.
-- Requer os scripts de status, pagamentos e retificação já instalados.
BEGIN;
ALTER TABLE public.orcamentos_finalizados
  ADD COLUMN IF NOT EXISTS envio_recebido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelamento jsonb,
  ADD COLUMN IF NOT EXISTS historico_cancelamentos jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS valor_original_aprovacao numeric(18,2),
  ADD COLUMN IF NOT EXISTS negociacao_aplicada boolean NOT NULL DEFAULT false;
-- Preserva inclusive registros retificados, que não podem sofrer UPDATE.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orcamentos_finalizados' AND column_name='envio_finalizado') THEN
    ALTER TABLE public.orcamentos_finalizados ADD COLUMN envio_finalizado boolean NOT NULL DEFAULT true;
    ALTER TABLE public.orcamentos_finalizados ALTER COLUMN envio_finalizado SET DEFAULT false;
    UPDATE public.orcamentos_finalizados SET envio_finalizado=false WHERE status IN (0,1) AND retificacao IS NULL;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.proteger_envio_lote() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.protocolo, 0));
  IF NEW.status IN (3,7,10) AND NOT NEW.envio_finalizado THEN
    RAISE EXCEPTION 'O posto ainda não concluiu o envio de todos os itens deste lote.' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS proteger_envio_lote ON public.orcamentos_finalizados;
CREATE TRIGGER proteger_envio_lote BEFORE INSERT OR UPDATE ON public.orcamentos_finalizados
FOR EACH ROW EXECUTE FUNCTION public.proteger_envio_lote();

CREATE OR REPLACE FUNCTION public.iniciar_lancamento_posto(p_protocolo text,p_id text,p_cnpj text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_protocolo,0));
  IF EXISTS(SELECT 1 FROM public.orcamentos_finalizados WHERE protocolo=p_protocolo AND
    (status NOT IN (0,1,8) OR envio_finalizado OR regexp_replace(cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g'))) THEN
    RAISE EXCEPTION 'Lote já está em análise ou não pertence ao posto.' USING ERRCODE='40001';
  END IF;
  UPDATE public.orcamentos_finalizados SET envio_finalizado=false WHERE protocolo=p_protocolo;
  UPDATE public.orcamentos_finalizados SET envio_recebido=false WHERE protocolo=p_protocolo AND oracle_item_id::text=p_id;
END; $$;

CREATE OR REPLACE FUNCTION public.receber_item_posto(p_item jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.orcamentos_finalizados%ROWTYPE; anterior public.orcamentos_finalizados%ROWTYPE; resultado jsonb;
BEGIN
  IF nullif(trim(p_item->>'protocolo'), '') IS NULL OR nullif(p_item->>'oracle_item_id','') IS NULL THEN
    RAISE EXCEPTION 'Item ou protocolo inválido.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_item->>'protocolo', 0));
  IF EXISTS (SELECT 1 FROM public.orcamentos_finalizados WHERE protocolo = p_item->>'protocolo' AND (status NOT IN (0,1,8) OR envio_finalizado)) THEN
    RAISE EXCEPTION 'Lote já está em análise; envio ou edição bloqueados.' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO anterior FROM public.orcamentos_finalizados WHERE oracle_item_id::text = p_item->>'oracle_item_id' FOR UPDATE;
  IF FOUND AND (anterior.protocolo <> p_item->>'protocolo' OR regexp_replace(anterior.cnpj,'\D','','g') <> regexp_replace(p_item->>'cnpj','\D','','g')) THEN
    RAISE EXCEPTION 'Item não pertence a este lote ou posto.';
  END IF;
  r := jsonb_populate_record(anterior, p_item);
  IF anterior.id IS NULL THEN
    INSERT INTO public.orcamentos_finalizados(oracle_item_id,protocolo,cnpj) VALUES(r.oracle_item_id,r.protocolo,r.cnpj) RETURNING id INTO r.id;
  END IF;
  UPDATE public.orcamentos_finalizados SET
    pa_usuario=r.pa_usuario, razao_social=r.razao_social, unidade=r.unidade, email_retorno=r.email_retorno,
    uuid=r.uuid,cod_barras=r.cod_barras,ean=r.ean,cod_gemco=r.cod_gemco,descricao=r.descricao,
    fornecedor=r.fornecedor,linha=r.linha,serial=r.serial,defeito_encontrado=r.defeito_encontrado,
    foto_nome=r.foto_nome,link_drive=r.link_drive,pecas_desc=r.pecas_desc,acess_desc=r.acess_desc,
    val_pecas=r.val_pecas,val_mao_obra=r.val_mao_obra,val_emb=r.val_emb,val_hig=r.val_hig,
    total_orcamento=r.total_orcamento,defeito_funcional=r.defeito_funcional,garantia=r.garantia,tipo_orc=r.tipo_orc,
    status=8,status_text='MONTAGEM',envio_recebido=true,envio_finalizado=false,cancelamento=NULL
  WHERE id=r.id RETURNING to_jsonb(orcamentos_finalizados.*) INTO resultado;
  -- As instalações usam nomes diferentes para acessórios.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orcamentos_finalizados' AND column_name='val_access') THEN
    EXECUTE 'UPDATE public.orcamentos_finalizados SET val_access=$1 WHERE id=$2' USING coalesce((p_item->>'val_acess')::numeric,0), r.id;
  ELSE
    EXECUTE 'UPDATE public.orcamentos_finalizados SET val_acess=$1 WHERE id=$2' USING coalesce((p_item->>'val_acess')::numeric,0), r.id;
  END IF;
  UPDATE public.orcamentos_finalizados SET envio_finalizado=false WHERE protocolo=r.protocolo;
  RETURN resultado;
END; $$;

CREATE OR REPLACE FUNCTION public.concluir_envio_lote(p_protocolo text,p_cnpj text,p_ids text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE completo boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_protocolo,0));
  IF cardinality(p_ids) IS NULL OR cardinality(p_ids)=0 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.orcamentos_finalizados WHERE protocolo=p_protocolo AND status NOT IN (0,1,8)) THEN
    RETURN false;
  END IF;
  SELECT count(*)=cardinality(p_ids) AND bool_and(envio_recebido AND cancelamento IS NULL)
    AND bool_and(oracle_item_id::text=ANY(p_ids))
    AND bool_and(regexp_replace(cnpj,'\D','','g')=regexp_replace(p_cnpj,'\D','','g'))
    INTO completo FROM public.orcamentos_finalizados WHERE protocolo=p_protocolo;
  -- Enquanto o posto lancar itens, o lote permanece em MONTAGEM. Somente a
  -- acao explicita "Finalizar" promove todos os itens para PENDENTE na AT.
  -- Uma tentativa incompleta nao pode reabrir nem alterar o lote.
  IF NOT coalesce(completo,false) THEN RETURN false; END IF;
  UPDATE public.orcamentos_finalizados SET
    envio_finalizado=coalesce(completo,false),
    status=case when coalesce(completo,false) then 0 else 8 end,
    status_text=case when coalesce(completo,false) then 'PENDENTE' else 'MONTAGEM' end
  WHERE protocolo=p_protocolo;
  RETURN coalesce(completo,false);
END; $$;

CREATE OR REPLACE FUNCTION public.cancelar_lancamento_posto(p_id bigint,p_cnpj text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.orcamentos_finalizados%ROWTYPE; evento jsonb;
BEGIN
  SELECT * INTO r FROM public.orcamentos_finalizados WHERE id=p_id;
  IF NOT FOUND OR regexp_replace(r.cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g') THEN RAISE EXCEPTION 'Item não encontrado para este posto.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.protocolo,0));
  IF EXISTS(SELECT 1 FROM public.orcamentos_finalizados WHERE protocolo=r.protocolo AND (status NOT IN (0,1,8) OR envio_finalizado))
    OR EXISTS(SELECT 1 FROM public.orcamento_negociacoes WHERE protocolo=r.protocolo) THEN
    RAISE EXCEPTION 'Lote já está em análise ou negociação; cancelamento bloqueado.' USING ERRCODE='40001';
  END IF;
  SELECT * INTO r FROM public.orcamentos_finalizados WHERE id=p_id FOR UPDATE;
  IF r.cancelamento IS NOT NULL THEN RETURN to_jsonb(r); END IF;
  evento := jsonb_build_object('data',now(),'total_anterior',r.total_orcamento,'oracle_item_id',r.oracle_item_id);
  UPDATE public.orcamentos_finalizados SET envio_finalizado=false WHERE protocolo=r.protocolo;
  UPDATE public.orcamentos_finalizados SET envio_recebido=false,cancelamento=evento,
    historico_cancelamentos=historico_cancelamentos || jsonb_build_array(evento),status_text='CANCELADO_POSTO',status=0
    WHERE id=p_id RETURNING * INTO r;
  RETURN to_jsonb(r);
END; $$;
CREATE OR REPLACE FUNCTION public.aprovar_negociacao_lote(p_protocolo text,p_ids text[],p_responsavel text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE n public.orcamento_negociacoes%ROWTYPE; ids bigint[]; base numeric; acumulado numeric:=0; anterior numeric:=0; parcela numeric; produto_base numeric; servico_base numeric; produto_aprovado numeric; r record; resultado jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_protocolo,0));
  SELECT * INTO n FROM public.orcamento_negociacoes WHERE protocolo=p_protocolo FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF n.negotiation_scope='ITEM' AND cardinality(p_ids)>0 AND NOT EXISTS(
    SELECT 1 FROM unnest(p_ids) AS t(id) WHERE n.item_ids @> jsonb_build_array(id)
  ) THEN RETURN NULL; END IF;
  IF n.status <> 'ACEITA_POSTO' OR n.valor_proposto_at IS NULL OR n.valor_proposto_at < 0 THEN
    RAISE EXCEPTION 'A negociação precisa de um valor válido e aceito pelo posto.' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.orcamentos_finalizados WHERE protocolo=p_protocolo ORDER BY id FOR UPDATE;
  SELECT array_agg(id ORDER BY id),sum(coalesce(valor_original_aprovacao,total_orcamento)) INTO ids,base
    FROM public.orcamentos_finalizados WHERE protocolo=p_protocolo
    AND (n.negotiation_scope='LOTE' OR n.item_ids @> jsonb_build_array(id::text));
  IF ids IS NULL THEN RAISE EXCEPTION 'Negociação sem itens.'; END IF;
  IF EXISTS(SELECT 1 FROM public.orcamentos_finalizados WHERE id=ANY(ids) AND
    (NOT envio_finalizado OR cancelamento IS NOT NULL OR retificacao IS NOT NULL OR upper(coalesce(status_text,'')) IN ('REPROVADO','RECUSADO','DEVOLUCAO') OR pagamento_status<>'AGUARDANDO_NOTA')) THEN
    RAISE EXCEPTION 'Lote incompleto, retificado, reprovado ou com pagamento iniciado. Revise a negociação.';
  END IF;
  IF cardinality(p_ids)>0 AND (cardinality(p_ids)<>cardinality(ids) OR EXISTS(SELECT 1 FROM unnest(ids) AS t(id) WHERE NOT id::text=ANY(p_ids))) THEN
    RAISE EXCEPTION 'Aprove todos os itens desta negociação juntos para preservar o valor acordado.';
  END IF;
  IF base IS NULL OR base<=0 THEN RAISE EXCEPTION 'Total original inválido; não é possível ratear o acordo.'; END IF;
  FOR r IN SELECT * FROM public.orcamentos_finalizados WHERE id=ANY(ids) ORDER BY id LOOP
    acumulado := acumulado + coalesce(r.valor_original_aprovacao,r.total_orcamento);
    parcela := round(n.valor_proposto_at * acumulado / base,2) - anterior;
    anterior := anterior + parcela;
    produto_base:=greatest(0,coalesce(r.val_pecas,0)+coalesce(r.val_access,0)+coalesce(r.val_emb,0));
    servico_base:=greatest(0,coalesce(r.val_mao_obra,0)+coalesce(r.val_hig,0));
    produto_aprovado:=CASE WHEN produto_base+servico_base>0 THEN round(parcela*produto_base/(produto_base+servico_base),2) ELSE parcela END;
    UPDATE public.orcamentos_finalizados SET valor_original_aprovacao=coalesce(valor_original_aprovacao,total_orcamento),
      total_orcamento=parcela,valor_pagamento=parcela,valor_produtos_aprovado=produto_aprovado,
      valor_servicos_aprovado=parcela-produto_aprovado,negociacao_aplicada=true,status=10,status_text='APROVADO',
      tratado_por=coalesce(nullif(p_responsavel,''),tratado_por) WHERE id=r.id;
  END LOOP;
  SELECT jsonb_build_object('items',jsonb_agg(to_jsonb(o))) INTO resultado FROM public.orcamentos_finalizados o WHERE id=ANY(ids);
  RETURN resultado;
END; $$;
REVOKE ALL ON FUNCTION public.aprovar_negociacao_lote(text,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_negociacao_lote(text,text[],text) TO service_role;
REVOKE ALL ON FUNCTION public.iniciar_lancamento_posto(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_lancamento_posto(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.receber_item_posto(jsonb), public.concluir_envio_lote(text,text,text[]), public.cancelar_lancamento_posto(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receber_item_posto(jsonb), public.concluir_envio_lote(text,text,text[]), public.cancelar_lancamento_posto(bigint,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
