-- ETAPA 2: fluxo de padronizacao de pecas (Ravenas). Rodar no Supabase (SQL Editor), depois de
-- item_padrao_catalogo_canonico.sql. Pode rodar mais de uma vez.
--
-- O que faz:
--  1. item_alias ganha historico (origem, quem registrou, quando, protocolo).
--  2. item_padrao_solicitacao: pedidos de padrao novo feitos pelos postos (um pendente por nome).
--  3. registrar_decisao_padrao(jsonb): chamada pelo portal (Function /item_padrao/decisao):
--       ALIAS       -> o posto escolheu um padrao existente para a descricao original (vira apelido).
--       SOLICITACAO -> o posto pediu um padrao novo (fica pendente de aprovacao).
--  4. aprovar_solicitacao_padrao / recusar_solicitacao_padrao: para quem aprova (AT/admin), pelo
--     SQL Editor por enquanto. Aprovar cria o padrao (ou liga a um existente), a linha e o apelido,
--     e o padrao ja aparece nos proximos recebimentos.
-- Nada aqui altera orcamentos ja enviados.
BEGIN;

-- Mesma normalizacao do portal (normalizarNome): sem acento, maiuscula, espacos colapsados.
CREATE OR REPLACE FUNCTION public.normalizar_nome_peca(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(upper(translate(coalesce(p, ''),
    'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝáàâãäåéèêëíìîïóòôõöúùûüçñý',
    'AAAAAAEEEEIIIIOOOOOUUUUCNYaaaaaaeeeeiiiiooooouuuucny')), '\s+', ' ', 'g'))
$$;

ALTER TABLE public.item_alias
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'SEED',
  ADD COLUMN IF NOT EXISTS registrado_por text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS protocolo text,
  ADD COLUMN IF NOT EXISTS criado_em timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.item_padrao_solicitacao (
  id              bigserial PRIMARY KEY,
  nome_original   text NOT NULL,
  nome_norm       text NOT NULL,
  nome_sugerido   text,
  tipo            text NOT NULL DEFAULT 'PECA',
  linha           text,
  status          text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
  qtd_pedidos     integer NOT NULL DEFAULT 1,
  cnpj            text,
  pa_usuario      text,
  protocolo       text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  codigo_aprovado text REFERENCES public.item_padrao(codigo),
  decidido_por    text,
  decidido_em     timestamptz,
  motivo_recusa   text
);
-- Um pedido pendente por nome: pedidos repetidos so somam qtd_pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS ux_item_padrao_solicitacao_pendente
  ON public.item_padrao_solicitacao(nome_norm) WHERE status = 'PENDENTE';

CREATE OR REPLACE FUNCTION public.registrar_decisao_padrao(p_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_tipo text := upper(coalesce(p_dados->>'tipo', ''));
  v_original text := btrim(coalesce(p_dados->>'nome_original', ''));
  v_norm text := normalizar_nome_peca(p_dados->>'nome_original');
  v_codigo text := btrim(coalesce(p_dados->>'codigo', ''));
  v_existente text;
  v_id bigint;
BEGIN
  IF v_norm = '' OR length(v_original) > 200 THEN RAISE EXCEPTION 'Descricao da peca invalida.'; END IF;

  IF v_tipo = 'ALIAS' THEN
    IF NOT EXISTS (SELECT 1 FROM item_padrao WHERE codigo = v_codigo AND ativo) THEN
      RAISE EXCEPTION 'Padrao % nao existe ou esta inativo.', v_codigo;
    END IF;
    -- Nome que ja e o canonico de outro padrao nao vira apelido.
    IF EXISTS (SELECT 1 FROM item_padrao WHERE nome_norm = v_norm AND codigo <> v_codigo) THEN
      RAISE EXCEPTION 'A descricao "%" ja e um padrao do catalogo.', v_original;
    END IF;
    SELECT codigo INTO v_existente FROM item_alias WHERE alias_norm = v_norm;
    IF v_existente IS NOT NULL THEN
      -- Ja ligado: nao troca o padrao de um apelido existente (evita um posto desfazer o de outro).
      RETURN jsonb_build_object('ok', true, 'tipo', 'ALIAS', 'codigo', v_existente, 'ja_existia', true);
    END IF;
    INSERT INTO item_alias (alias_norm, alias, codigo, origem, registrado_por, cnpj, protocolo)
    VALUES (v_norm, v_original, v_codigo, 'POSTO', p_dados->>'pa_usuario', p_dados->>'cnpj', p_dados->>'protocolo');
    RETURN jsonb_build_object('ok', true, 'tipo', 'ALIAS', 'codigo', v_codigo, 'ja_existia', false);
  END IF;

  IF v_tipo = 'SOLICITACAO' THEN
    INSERT INTO item_padrao_solicitacao (nome_original, nome_norm, nome_sugerido, tipo, linha, cnpj, pa_usuario, protocolo)
    VALUES (v_original, v_norm, nullif(btrim(coalesce(p_dados->>'nome_sugerido', '')), ''), coalesce(nullif(p_dados->>'tipo_item', ''), 'PECA'),
      nullif(p_dados->>'linha', ''), p_dados->>'cnpj', p_dados->>'pa_usuario', p_dados->>'protocolo')
    ON CONFLICT (nome_norm) WHERE status = 'PENDENTE'
    DO UPDATE SET qtd_pedidos = item_padrao_solicitacao.qtd_pedidos + 1, atualizado_em = now()
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok', true, 'tipo', 'SOLICITACAO', 'id', v_id);
  END IF;

  RAISE EXCEPTION 'Tipo de decisao invalido.';
END $$;

-- Aprovar: p_codigo_existente liga o pedido a um padrao que ja existe; sem ele, cria o padrao com
-- p_nome_canonico (ou o nome sugerido / original). Em ambos os casos a descricao original vira apelido.
CREATE OR REPLACE FUNCTION public.aprovar_solicitacao_padrao(
  p_id bigint, p_usuario text, p_nome_canonico text DEFAULT NULL, p_codigo_existente text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  s item_padrao_solicitacao%ROWTYPE;
  v_codigo text;
  v_nome text;
BEGIN
  SELECT * INTO s FROM item_padrao_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'PENDENTE' THEN RAISE EXCEPTION 'Pedido % nao esta pendente.', p_id; END IF;

  IF nullif(p_codigo_existente, '') IS NOT NULL THEN
    SELECT codigo INTO v_codigo FROM item_padrao WHERE codigo = p_codigo_existente AND ativo;
    IF v_codigo IS NULL THEN RAISE EXCEPTION 'Padrao % nao existe.', p_codigo_existente; END IF;
  ELSE
    v_nome := upper(btrim(coalesce(nullif(p_nome_canonico, ''), s.nome_sugerido, s.nome_original)));
    SELECT codigo INTO v_codigo FROM item_padrao WHERE nome_norm = normalizar_nome_peca(v_nome);
    IF v_codigo IS NULL THEN
      -- Proximo codigo da sequencia PEC0000 (trava a tabela para dois aprovadores nao gerarem o mesmo).
      LOCK TABLE item_padrao IN SHARE ROW EXCLUSIVE MODE;
      SELECT 'PEC' || lpad((coalesce(max(substring(codigo FROM '^PEC(\d+)$')::int), 0) + 1)::text, 4, '0')
        INTO v_codigo FROM item_padrao;
      INSERT INTO item_padrao (codigo, nome_canonico, nome_norm, tipo) VALUES (v_codigo, v_nome, normalizar_nome_peca(v_nome), s.tipo);
    END IF;
  END IF;

  IF s.linha IS NOT NULL THEN
    INSERT INTO item_padrao_linha (codigo, linha) VALUES (v_codigo, s.linha) ON CONFLICT DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM item_padrao WHERE nome_norm = s.nome_norm) THEN
    INSERT INTO item_alias (alias_norm, alias, codigo, origem, registrado_por, cnpj, protocolo)
    VALUES (s.nome_norm, s.nome_original, v_codigo, 'APROVACAO', p_usuario, s.cnpj, s.protocolo)
    ON CONFLICT (alias_norm) DO NOTHING;
  END IF;
  UPDATE item_padrao_solicitacao
    SET status = 'APROVADA', codigo_aprovado = v_codigo, decidido_por = p_usuario, decidido_em = now(), atualizado_em = now()
    WHERE id = p_id;
  RETURN v_codigo;
END $$;

CREATE OR REPLACE FUNCTION public.recusar_solicitacao_padrao(p_id bigint, p_usuario text, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE item_padrao_solicitacao
    SET status = 'RECUSADA', motivo_recusa = p_motivo, decidido_por = p_usuario, decidido_em = now(), atualizado_em = now()
    WHERE id = p_id AND status = 'PENDENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido % nao esta pendente.', p_id; END IF;
END $$;

-- So o servidor (service_role, usado pelas Functions) chama estas funcoes.
REVOKE ALL ON FUNCTION public.registrar_decisao_padrao(jsonb),
  public.aprovar_solicitacao_padrao(bigint, text, text, text),
  public.recusar_solicitacao_padrao(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_decisao_padrao(jsonb),
  public.aprovar_solicitacao_padrao(bigint, text, text, text),
  public.recusar_solicitacao_padrao(bigint, text, text) TO service_role;
ALTER TABLE public.item_padrao_solicitacao ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Pedidos pendentes (mais pedidos primeiro):
--   SELECT id, nome_original, nome_sugerido, linha, qtd_pedidos, cnpj, criado_em
--   FROM item_padrao_solicitacao WHERE status = 'PENDENTE' ORDER BY qtd_pedidos DESC, criado_em;
-- Aprovar criando padrao novo:      SELECT aprovar_solicitacao_padrao(12, 'seu.usuario', 'TAMPA TRASEIRA');
-- Aprovar ligando a um existente:   SELECT aprovar_solicitacao_padrao(12, 'seu.usuario', NULL, 'PEC0030');
-- Recusar:                          SELECT recusar_solicitacao_padrao(12, 'seu.usuario', 'Use PLACA PRINCIPAL');
