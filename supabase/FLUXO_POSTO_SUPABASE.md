# Rascunho do posto e envio para AT

No SQL Editor do Supabase compartilhado por Ravenas e RMS, executar nesta ordem:

1. `lotes_envio_seguro.sql` atualizado (salva Montagem 8; finaliza Pendente 0).
2. `orcamento_posto_supabase.sql`.

Depois publicar esta branch na Netlify. Publicar o codigo nao instala as funcoes do banco.

Cadastro e preenchimento ficam em `orcamento_lancamento_rascunhos`. Cada produto
recebe um ID gerado no Supabase; o nome legado `oracle_item_id` continua apenas
por compatibilidade entre as tabelas. Nao ocorre consulta ao Oracle nesse fluxo.

Salvar confirma os valores de um produto e conserva o lote em Montagem (8).
Finalizar verifica todos os produtos cadastrados, transfere seus valores para
`orcamentos_finalizados` e define status 0, PENDENTE, envio_finalizado=true em
uma transacao. Se algum produto nao foi salvo, nada e finalizado.

A migracao preserva os registros existentes e recupera lotes incompletos que
ja estejam em `orcamentos_finalizados`. Nao importa dados de sistemas externos.
Um erro 404/PGRST205 no rascunho ou PGRST202 em uma RPC deve ser conferido pela
resposta da requisicao: pode indicar migracao ainda nao instalada no projeto
configurado nas variaveis `SUPABASE_ORCAMENTOS_*` da Netlify.

Verificacao depois de salvar: o rascunho permanece MONTAGEM e nenhum registro
novo entra na tabela final. Depois de Finalizar: todos os itens do protocolo
aparecem com status 0 e envio_finalizado=true na tabela final e na fila da AT.
