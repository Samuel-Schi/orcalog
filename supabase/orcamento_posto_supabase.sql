-- Executar DEPOIS de lotes_envio_seguro.sql. Fluxo do posto inteiramente no Supabase.
BEGIN;
CREATE TABLE IF NOT EXISTS public.orcamento_lancamento_rascunhos (
  id bigserial PRIMARY KEY, pa_usuario text NOT NULL, oracle_item_id bigint NOT NULL,
  protocolo text, cnpj text, status text NOT NULL DEFAULT 'RASCUNHO',
  payload jsonb NOT NULL DEFAULT '{}', criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_lancamento_rascunhos_user_item_idx
  ON public.orcamento_lancamento_rascunhos(pa_usuario,oracle_item_id);
CREATE INDEX IF NOT EXISTS orcamento_lancamento_rascunhos_lote_idx
  ON public.orcamento_lancamento_rascunhos(protocolo,cnpj);
CREATE SEQUENCE IF NOT EXISTS public.orcamento_posto_item_seq START WITH 1000000000000;
ALTER TABLE public.orcamentos_finalizados ADD COLUMN IF NOT EXISTS pecas_detalhes text,
  ADD COLUMN IF NOT EXISTS acess_detalhes text;
ALTER TABLE public.orcamento_lancamento_rascunhos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orcamento_lancamento_rascunhos FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.orcamento_lancamento_rascunhos TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.orcamento_posto_item_seq,public.orcamento_lancamento_rascunhos_id_seq TO service_role;

-- Mantem os registros legados; copia apenas lotes ainda nao entregues para a AT.
INSERT INTO public.orcamento_lancamento_rascunhos(pa_usuario,oracle_item_id,protocolo,cnpj,status,payload)
SELECT coalesce(pa_usuario,''),oracle_item_id::bigint,protocolo,cnpj,
  CASE WHEN envio_recebido AND cancelamento IS NULL THEN 'MONTAGEM' ELSE 'RASCUNHO' END,
  to_jsonb(o) - 'id'
FROM public.orcamentos_finalizados o
WHERE NOT envio_finalizado AND status IN (0,1,8) AND oracle_item_id::text ~ '^[0-9]+$'
ON CONFLICT(pa_usuario,oracle_item_id) DO UPDATE SET
  payload=EXCLUDED.payload || jsonb_build_object('rascunho',orcamento_lancamento_rascunhos.payload),
  status=EXCLUDED.status,cnpj=EXCLUDED.cnpj,protocolo=EXCLUDED.protocolo
WHERE NOT (orcamento_lancamento_rascunhos.payload ? 'oracle_item_id');

CREATE OR REPLACE FUNCTION public.registrar_lote_posto(p_itens jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE item jsonb; prot text; documento text; usuario text; existente jsonb; item_id bigint;
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'Informe os produtos do lote.'; END IF;
  prot:=trim(p_itens->0->>'protocolo'); documento:=p_itens->0->>'cnpj'; usuario:=p_itens->0->>'pa_usuario';
  IF coalesce(prot,'')='' OR coalesce(documento,'') !~ '^[0-9]{14}$' OR coalesce(usuario,'')='' THEN RAISE EXCEPTION 'Informe protocolo e posto.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(prot,0));
  IF EXISTS(SELECT 1 FROM orcamentos_finalizados WHERE protocolo=prot AND (envio_finalizado OR status NOT IN(0,1,8))) THEN RAISE EXCEPTION 'Lote ja enviado para a AT.'; END IF;
  IF EXISTS(SELECT 1 FROM orcamento_lancamento_rascunhos WHERE protocolo=prot) THEN
    -- Retry do mesmo cadastro e idempotente. Um cadastro diferente nunca substitui o lote.
    SELECT jsonb_agg(jsonb_build_array(payload->>'uuid',payload->>'serial',payload->>'cod_gemco',payload->>'cod_barras') ORDER BY payload->>'serial',payload->>'uuid',payload->>'cod_gemco',payload->>'cod_barras')
      INTO existente FROM orcamento_lancamento_rascunhos WHERE protocolo=prot AND cnpj=documento AND pa_usuario=usuario;
    IF existente IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_array(x->>'uuid',x->>'serial',x->>'cod_gemco',x->>'cod_barras') ORDER BY x->>'serial',x->>'uuid',x->>'cod_gemco',x->>'cod_barras') FROM jsonb_array_elements(p_itens) x)
      THEN RAISE EXCEPTION 'Protocolo ja cadastrado com outros itens.'; END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF item->>'protocolo' IS DISTINCT FROM prot OR item->>'cnpj' IS DISTINCT FROM documento OR item->>'pa_usuario' IS DISTINCT FROM usuario THEN RAISE EXCEPTION 'Itens de lotes diferentes.'; END IF;
    item_id:=nextval('orcamento_posto_item_seq');
    INSERT INTO orcamento_lancamento_rascunhos(pa_usuario,oracle_item_id,protocolo,cnpj,status,payload)
    VALUES(usuario,item_id,prot,documento,'RASCUNHO',item || jsonb_build_object('oracle_item_id',item_id,'status',8,'status_text','MONTAGEM'));
  END LOOP;
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.salvar_item_montagem(p_item jsonb,p_confirmado boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r orcamento_lancamento_rascunhos%ROWTYPE; prot text:=p_item->>'protocolo';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(prot,0));
  SELECT * INTO r FROM orcamento_lancamento_rascunhos WHERE protocolo=prot
    AND oracle_item_id::text=p_item->>'oracle_item_id' AND cnpj=p_item->>'cnpj' AND pa_usuario=p_item->>'pa_usuario' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto nao cadastrado neste lote. Atualize a lista.'; END IF;
  IF r.status='FINALIZADO' OR EXISTS(SELECT 1 FROM orcamentos_finalizados WHERE protocolo=prot AND (envio_finalizado OR status NOT IN(0,1,8))) THEN RAISE EXCEPTION 'Lote ja enviado para a AT.'; END IF;
  -- Autosave atrasado nao pode sobrescrever o clique em Salvar.
  IF NOT p_confirmado AND r.status='MONTAGEM' THEN RETURN to_jsonb(r); END IF;
  UPDATE orcamento_lancamento_rascunhos SET
    payload=CASE WHEN p_confirmado THEN (payload - 'rascunho') || p_item ELSE payload || jsonb_build_object('rascunho',p_item->'rascunho') END,
    status=CASE WHEN p_confirmado THEN 'MONTAGEM' ELSE 'RASCUNHO' END, atualizado_em=now()
  WHERE id=r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.finalizar_montagem_posto(p_protocolo text,p_cnpj text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r orcamento_lancamento_rascunhos%ROWTYPE; ids text[]; completo boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_protocolo,0));
  IF NOT EXISTS(SELECT 1 FROM orcamento_lancamento_rascunhos WHERE protocolo=p_protocolo AND cnpj=p_cnpj) THEN RAISE EXCEPTION 'Lote nao encontrado para este posto.'; END IF;
  IF EXISTS(SELECT 1 FROM orcamento_lancamento_rascunhos WHERE protocolo=p_protocolo AND (cnpj IS DISTINCT FROM p_cnpj OR status NOT IN('MONTAGEM','FINALIZADO'))) THEN RAISE EXCEPTION 'Salve os valores de todos os produtos antes de finalizar.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM orcamento_lancamento_rascunhos WHERE protocolo=p_protocolo AND status<>'FINALIZADO') THEN RETURN true; END IF;
  FOR r IN SELECT * FROM orcamento_lancamento_rascunhos WHERE protocolo=p_protocolo ORDER BY id FOR UPDATE LOOP
    PERFORM receber_item_posto(r.payload || jsonb_build_object('oracle_item_id',r.oracle_item_id,'protocolo',r.protocolo,'cnpj',r.cnpj,'pa_usuario',r.pa_usuario));
    UPDATE orcamentos_finalizados SET pecas_detalhes=r.payload->>'pecas_detalhes',acess_detalhes=r.payload->>'acess_detalhes'
      WHERE oracle_item_id::text=r.oracle_item_id::text AND protocolo=p_protocolo;
  END LOOP;
  SELECT array_agg(oracle_item_id::text) INTO ids FROM orcamento_lancamento_rascunhos WHERE protocolo=p_protocolo;
  completo:=concluir_envio_lote(p_protocolo,p_cnpj,ids);
  IF NOT completo THEN RAISE EXCEPTION 'Os itens do lote nao conferem. Nenhuma finalizacao foi aplicada.'; END IF;
  UPDATE orcamento_lancamento_rascunhos SET status='FINALIZADO',atualizado_em=now() WHERE protocolo=p_protocolo;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.cancelar_montagem_posto(p_protocolo text,p_cnpj text,p_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_protocolo,0));
  IF EXISTS(SELECT 1 FROM orcamentos_finalizados WHERE protocolo=p_protocolo AND (envio_finalizado OR status NOT IN(0,1,8))) THEN RAISE EXCEPTION 'Lote ja enviado para a AT.'; END IF;
  UPDATE orcamento_lancamento_rascunhos SET status='RASCUNHO',atualizado_em=now()
    WHERE protocolo=p_protocolo AND cnpj=p_cnpj AND oracle_item_id::text=p_id AND status='MONTAGEM';
  IF NOT FOUND THEN RAISE EXCEPTION 'Lancamento nao encontrado neste lote.'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.listar_orcamentos_posto(p_cnpj text,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
SELECT coalesce(jsonb_agg(item),'[]'::jsonb) FROM (
 SELECT item FROM (
  SELECT d.payload || jsonb_build_object('id',d.oracle_item_id,'oracle_item_id',d.oracle_item_id,
    'protocolo',d.protocolo,'cnpj',d.cnpj,'status',8,'status_text','MONTAGEM',
    'envio_finalizado',false,'envio_recebido',d.status='MONTAGEM','criado_em',d.criado_em) item
  FROM orcamento_lancamento_rascunhos d WHERE d.cnpj=p_cnpj AND d.status<>'FINALIZADO'
  UNION ALL
  SELECT to_jsonb(o) || jsonb_build_object('id',o.oracle_item_id,'supabase_id',o.id,'val_acess',coalesce(to_jsonb(o)->'val_access',to_jsonb(o)->'val_acess'))
  FROM orcamentos_finalizados o WHERE o.cnpj=p_cnpj AND NOT EXISTS(
    SELECT 1 FROM orcamento_lancamento_rascunhos d WHERE d.protocolo=o.protocolo AND d.oracle_item_id::text=o.oracle_item_id::text AND d.status<>'FINALIZADO')
 ) dados ORDER BY item->>'protocolo',item->>'oracle_item_id' LIMIT 500 OFFSET greatest(0,p_offset)
) pagina;
$$;

REVOKE ALL ON FUNCTION public.registrar_lote_posto(jsonb),public.salvar_item_montagem(jsonb,boolean),public.finalizar_montagem_posto(text,text),public.listar_orcamentos_posto(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancelar_montagem_posto(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_montagem_posto(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_lote_posto(jsonb),public.salvar_item_montagem(jsonb,boolean),public.finalizar_montagem_posto(text,text),public.listar_orcamentos_posto(text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
