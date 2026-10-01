# Publicação coordenada: Ravenas + RMS

Não publicar somente um portal. As alterações dependem do banco compartilhado.

1. Em homologação, aplicar os scripts atuais de orçamento/status, pagamentos e retificação do RMS.
2. Executar `lotes_envio_seguro.sql` no mesmo Supabase utilizado pelos dois portais.
3. Publicar Ravenas e RMS em janela coordenada. Até publicar o filtro do RMS, a fila antiga pode continuar mostrando pendentes; o trigger já impede sua análise.
4. Testar um lote novo com dois itens: primeiro envio não aparece no RMS; segundo envio libera ambos. Falha de sincronização não deve remover o item da tela de lançamento.
5. Antes da análise, cancelar um lançamento em Meus Envios, reconfirmando a senha. O lote sai da fila; Editar / relançar usa o mesmo ID/protocolo. Cancelamento é lógico, não apaga o produto no Oracle.
6. Negociar 300,00 para 250,01, aceitar no posto e aprovar todos os itens do acordo. Conferir soma dos valores oficiais e do pagamento: 250,01. O desconto não é aplicado duas vezes. Acordos com rejeição/retificação ou pagamento iniciado exigem revisão e são bloqueados.

## Ordem de migração

No Supabase compartilhado, executar primeiro os scripts de status e retificação, depois `migracao-pagamento-lote.sql` do RMS e, por último, `lotes_envio_seguro.sql`. A migração de pagamento cria os limites separados de Produto e Serviço utilizados no faturamento e no acordo por lote.

## Legado

Lotes em análise/negociação/finalizados são preservados. Pendentes anteriores à migração ficam bloqueados até o reenvio dos itens pelo mesmo cadastro: a base antiga não comprova envio completo. Não marcar todos como recebidos indiscriminadamente. O botão Conferir envio completo repete a verificação após falha de rede, sem criar protocolos.

O conjunto esperado de IDs vem da união das APIs Oracle `get_envios` e `get_orcamentos_analise`, ambas paginadas, não de uma contagem enviada pelo navegador. Assim, inclui também itens aguardando lançamento. Falha ou paginação inconsistente em qualquer uma impede a liberação. Validar essas duas fontes com lote real em homologação antes da publicação.

Os acessos diretos legados ao Oracle não participam da transação do Supabase. A análise e os valores oficiais são protegidos no Supabase; não se oferece exclusão física ou recriação de protocolos no Oracle.

## Testes locais

`node --test tests/lote-envio.test.mjs tests/resultado-orcamento.test.mjs tests/pagamentos-consolidado.test.mjs`

`tests/lotes-envio-db.test.mjs` testa a migração em PostgreSQL em memória. Definir `PGLITE_TEST_MODULE` com o caminho do módulo PGlite instalado fora do repositório; sem essa variável o teste é ignorado. O teste usa os scripts RMS do workspace irmão. Nada é executado em produção.
