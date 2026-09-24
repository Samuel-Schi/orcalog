# Orçalog (Frontend)

Frontend do sistema de **gestão de envio de orçamentos** (Login, Novo Orçamento e Meus Envios), separado da área de aprovação.

## Stack
- React + TypeScript
- Vite
- TailwindCSS
- React Router

## Requisitos
- Node.js 18+ (recomendado)
- npm

## Como rodar local
```bash
npm install
npm run dev
```

## API no localhost (proxy Vite)
- O frontend chama `/api-check-user` e `/api-bet-user-inf`.
- No `npm run dev`, o Vite faz proxy para o ORDS via `VITE_ORDS_BASE_URL`.
- Se precisar trocar o endpoint, copie `.env.example` para `.env` e ajuste `VITE_ORDS_BASE_URL`.

O comando de desenvolvimento usa os certificados confiáveis do sistema quando
o Node oferece `--use-system-ca` (incluindo o Node 22.19). Isso permite acessar
o Oracle em redes com certificados corporativos sem desativar a validação HTTPS.
Se o login retornar erro 500 por `SELF_SIGNED_CERT_IN_CHAIN`, use uma versão do
Node com esse suporte e reinicie `npm run dev`. Em versões anteriores, configure
`NODE_EXTRA_CA_CERTS` com o arquivo PEM da autoridade certificadora da sua rede.


## Build
```bash
npm run build
npm run preview
```

## Rotas
- `/login`
- `/novo-orcamento`
- `/meus-envios`

## Estrutura
- `src/pages/Login.tsx`
- `src/pages/NovoOrcamento.tsx`
- `src/pages/MeusEnvios.tsx`
- `src/components/SidebarLayout.tsx`
- `src/styles/index.css`

## Netlify
Arquivo `netlify.toml` já incluído com:
- build/publish
- redirects para funções
- fallback do React

## Observações
- Login no momento é apenas visual (frontend). A integração com backend será feita depois.
- O layout e as cores seguem o padrão enviado pelo time.

## Próximos passos sugeridos
1. Integrar login e dados reais do protocolo.
2. Persistir itens no backend.
3. Ativar endpoints Netlify Functions.

## Catalogo de qualidade
A tela Lancar Orcamentos consulta `public.catalogo_qualidade` pelo endpoint
`/catalogo_qualidade`, em producao no Netlify. Usa somente registros com
`ativo = true`, agrupa por `linha` e `tipo`, e exibe `item` nas listas existentes.
Tipos usados: PECA, ACESSORIO, DEFEITO e SERVICO (tambem aceita plurais e acentos).
As linhas sem registros continuam com o preenchimento manual existente.

Configure no servidor `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, ou as
variaveis existentes `SUPABASE_ORCAMENTOS_URL` e
`SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY`. A chave permanece no servidor.

## Enviar codigo e publicar
No Windows, execute na raiz do projeto:

```powershell
.\scripts\publicar.cmd
```

O comando verifica TypeScript, compila, confere se a main remota pode receber
as alteracoes, cria um commit dos arquivos do projeto e envia para `origin/main`.
Nao inclui `.env`, `node_modules` nem `dist`. Precisa de autenticacao Git no GitHub.
Se o envio falhar depois do commit, execute novamente para tentar o push.

O workflow `.github/workflows/ci.yml` verifica TypeScript e build nos pushes
para main e nos pull requests. Tambem pode ser executado na aba Actions.
No Netlify, conecte `Samuel-Schi/orcalog` e selecione `main` como branch de producao.
O `netlify.toml` exige TypeScript e build antes da publicacao. As variaveis do
Supabase permanecem configuradas no Netlify; nenhuma chave precisa ir ao GitHub.
O GitHub Actions faz a validacao; o deploy automatico e feito pela conexao Git do Netlify.
