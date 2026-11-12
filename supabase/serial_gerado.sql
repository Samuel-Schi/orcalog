-- ETAPA 3: identificador unico para peca sem Serial Number (Ravenas). Rodar no Supabase (SQL Editor).
-- Pode rodar mais de uma vez.
--
-- Produto sem serial na planilha (ou no lancamento manual) recebe, no envio do lote, um identificador
-- gerado aqui: SSAT + 8 digitos (no portal aparece como SSAT-0000-0123, mesmo formato dos seriais).
--  * Unico: vem de uma SEQUENCE (dois envios ao mesmo tempo nunca recebem o mesmo numero).
--  * Estavel: a mesma peca do mesmo lote (cnpj + protocolo + chave do item) recebe sempre o mesmo
--    identificador, entao "Tentar novamente" nao gera outro.
--  * Historico: cada identificador gerado fica em serial_gerado com posto, lote, NF, gemco e data.
-- Depois de gerado, o identificador e usado como serial em todo o resto (validacoes, lote, AT, romaneio).
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.serial_gerado_seq;

CREATE TABLE IF NOT EXISTS public.serial_gerado (
  codigo      text PRIMARY KEY CHECK (codigo ~ '^SSAT[0-9]{8,}$'),
  cnpj        text NOT NULL,
  protocolo   text NOT NULL,
  chave_item  text NOT NULL,
  nota_fiscal text,
  cod_gemco   text,
  pa_usuario  text,
  gerado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cnpj, protocolo, chave_item)
);
ALTER TABLE public.serial_gerado ENABLE ROW LEVEL SECURITY;

-- p_itens: [{ "chave": "...", "nota_fiscal": "...", "cod_gemco": "..." }]
-- Retorna [{ "chave": "...", "codigo": "SSAT00000001" }] na mesma ordem.
CREATE OR REPLACE FUNCTION public.gerar_seriais_peca(p_cnpj text, p_protocolo text, p_pa_usuario text, p_itens jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_protocolo text := btrim(coalesce(p_protocolo, ''));
  v_resultado jsonb := '[]'::jsonb;
  r record;
  v_codigo text;
BEGIN
  IF length(v_cnpj) <> 14 OR v_protocolo = '' THEN RAISE EXCEPTION 'Posto ou protocolo invalido.'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 OR jsonb_array_length(p_itens) > 200 THEN
    RAISE EXCEPTION 'Informe de 1 a 200 itens.';
  END IF;

  FOR r IN SELECT x->>'chave' AS chave, x->>'nota_fiscal' AS nf, x->>'cod_gemco' AS gemco
           FROM jsonb_array_elements(p_itens) WITH ORDINALITY AS t(x, n) ORDER BY n LOOP
    IF coalesce(r.chave, '') !~ '^[A-Za-z0-9-]{8,64}$' THEN RAISE EXCEPTION 'Chave de item invalida.'; END IF;
    SELECT codigo INTO v_codigo FROM serial_gerado WHERE cnpj = v_cnpj AND protocolo = v_protocolo AND chave_item = r.chave;
    IF v_codigo IS NULL THEN
      INSERT INTO serial_gerado (codigo, cnpj, protocolo, chave_item, nota_fiscal, cod_gemco, pa_usuario)
      VALUES ('SSAT' || lpad(nextval('serial_gerado_seq')::text, 8, '0'), v_cnpj, v_protocolo, r.chave, r.nf, r.gemco, p_pa_usuario)
      -- Duas chamadas simultaneas para o mesmo item: a segunda le o que a primeira gravou.
      ON CONFLICT (cnpj, protocolo, chave_item) DO NOTHING
      RETURNING codigo INTO v_codigo;
      IF v_codigo IS NULL THEN
        SELECT codigo INTO v_codigo FROM serial_gerado WHERE cnpj = v_cnpj AND protocolo = v_protocolo AND chave_item = r.chave;
      END IF;
    END IF;
    v_resultado := v_resultado || jsonb_build_array(jsonb_build_object('chave', r.chave, 'codigo', v_codigo));
  END LOOP;
  RETURN v_resultado;
END $$;

REVOKE ALL ON FUNCTION public.gerar_seriais_peca(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gerar_seriais_peca(text, text, text, jsonb) TO service_role;

COMMIT;

-- Consultar: SELECT * FROM serial_gerado WHERE protocolo = 'P1211-1234' ORDER BY codigo;
