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

## CNPJ (Serpro)
Para consulta automática do CNPJ, use o proxy via Netlify Functions:

1. Crie `.env` a partir de `.env.example`
2. Rode:
```bash
netlify dev
```

A consulta usa `/api-cnpj/{cnpj}`.

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
