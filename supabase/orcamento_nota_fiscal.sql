-- Fase 3: Nota fiscal no item do orcamento.
-- A NF identifica o item (no lugar do uuid, por hora). O VALOR nao entra aqui.
-- orcamento_lancamento_rascunhos.payload (jsonb) ja guarda nota_fiscal automaticamente;
-- esta migracao so cuida da tabela tipada orcamentos_finalizados.
BEGIN;

ALTER TABLE public.orcamentos_finalizados ADD COLUMN IF NOT EXISTS nota_fiscal text;

-- Recria salvar_orcamento_montagem_rapido identica a atual, so adicionando nota_fiscal no UPDATE.
-- jsonb_populate_record popula r.nota_fiscal a partir do payload (buildRecord envia 'nota_fiscal').
CREATE OR REPLACE FUNCTION public.salvar_orcamento_montagem_rapido(p_item jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.orcamentos_finalizados%ROWTYPE; rid bigint; tem_access boolean;
BEGIN
  r := jsonb_populate_record(NULL::public.orcamentos_finalizados, p_item);
  SELECT id INTO rid FROM orcamentos_finalizados WHERE oracle_item_id::text=p_item->>'oracle_item_id' FOR UPDATE;
  IF rid IS NULL THEN
    INSERT INTO orcamentos_finalizados(oracle_item_id,protocolo,cnpj) VALUES(r.oracle_item_id,r.protocolo,r.cnpj) RETURNING id INTO rid;
  END IF;
  UPDATE orcamentos_finalizados SET
    pa_usuario=r.pa_usuario, razao_social=r.razao_social, unidade=r.unidade, email_retorno=r.email_retorno,
    uuid=r.uuid,cod_barras=r.cod_barras,ean=r.ean,cod_gemco=r.cod_gemco,descricao=r.descricao,
    fornecedor=r.fornecedor,linha=r.linha,serial=r.serial,defeito_encontrado=r.defeito_encontrado,
    nota_fiscal=r.nota_fiscal,
    foto_nome=r.foto_nome,link_drive=r.link_drive,pecas_desc=r.pecas_desc,acess_desc=r.acess_desc,
    val_pecas=r.val_pecas,val_mao_obra=r.val_mao_obra,val_emb=r.val_emb,val_hig=r.val_hig,
    total_orcamento=r.total_orcamento,defeito_funcional=r.defeito_funcional,garantia=r.garantia,tipo_orc=r.tipo_orc,
    pecas_detalhes=p_item->>'pecas_detalhes',acess_detalhes=p_item->>'acess_detalhes',
    status=8,status_text='MONTAGEM',envio_recebido=true,envio_finalizado=false,cancelamento=NULL
  WHERE id=rid;
  SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.orcamentos_finalizados'::regclass
    AND attname='val_access' AND NOT attisdropped) INTO tem_access;
  IF tem_access THEN
    EXECUTE 'UPDATE public.orcamentos_finalizados SET val_access=$1 WHERE id=$2' USING coalesce((p_item->>'val_acess')::numeric,0), rid;
  ELSE
    EXECUTE 'UPDATE public.orcamentos_finalizados SET val_acess=$1 WHERE id=$2' USING coalesce((p_item->>'val_acess')::numeric,0), rid;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.salvar_orcamento_montagem_rapido(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_orcamento_montagem_rapido(jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
