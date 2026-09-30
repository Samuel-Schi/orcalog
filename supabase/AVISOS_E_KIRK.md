# Ativação de avisos e Kirk

1. No projeto Supabase usado pelo Ravenas, executar `pagamentos_setup.sql`
   (inclui a coluna opcional `kirk_numero`).
2. Executar `notificacoes_pa.sql` após as tabelas de orçamentos e negociações
   existirem. A migração usa os nomes padrão `orcamentos_finalizados` e
   `orcamento_negociacoes`; adaptar os alvos se o ambiente usa outros nomes.
3. Publicar frontend e funções juntos após aplicar as migrações.

Os avisos são eventos persistidos no banco a partir da migração. Mudanças de
status de itens e propostas de negociação pendentes do POSTO geram avisos,
inclusive com o portal fechado. Eventos anteriores não são reconstruídos.
O portal consulta até 100 avisos não lidos a cada 30 segundos. Ao marcar um
aviso como lido, a leitura vale para o posto (CNPJ), em todos os dispositivos.
O endpoint segue o contrato existente de identificação do posto por CNPJ.

Kirk é uma referência textual opcional, de até 80 caracteres, registrada junto
da nota fiscal e devolvida na consulta do pagamento por protocolo. Não abre
chamado no sistema Kirk nem modifica o PDF enviado.

## Homologação

- Alterar status de um item de teste e conferir aviso no posto correspondente.
- Criar/alterar proposta com ação pendente de POSTO e conferir aviso.
- Repetir gravação sem alterar status/proposta: não deve gerar novo aviso.
- Deixar o portal fechado durante a alteração e verificar o aviso ao entrar.
- Marcar como lido, recarregar e verificar em outro dispositivo do mesmo posto.
- Abrir o orçamento pelo aviso e verificar o filtro e os detalhes do protocolo.
- Enviar PDF com Kirk `K-00123`, recarregar pagamentos e conferir o mesmo número.
- Enviar nota sem Kirk e verificar compatibilidade com o fluxo anterior.
- Verificar leitura QR em iPhone e Android reais, incluindo negar câmera e
  fechar o leitor enquanto a permissão está sendo solicitada.

Executar com registros de homologação; os testes automatizados usam respostas
simuladas e não comprovam aplicação da migração nem funcionamento em produção.
