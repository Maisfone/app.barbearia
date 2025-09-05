Barbearia — Sistema de Fila (API + Front)

Passo a passo para rodar localmente:

1) Banco de Dados (PostgreSQL)
- Credenciais (seu cenário): host `localhost`, usuário `postgres`, senha `#abc123#`, DB `barbearia`.
- Importante: em URLs, o caractere `#` precisa ser codificado como `%23`.
- Já deixei `server/.env` pronto com: `postgres://postgres:%23abc123%23@localhost:5432/barbearia`.
- Se preferir Docker: `docker compose up -d db` (ajuste a senha conforme desejar).

2) API (Node/Express)
- Copie `server/.env.example` para `server/.env` e ajuste `DATABASE_URL`, `PORT` e `ALLOWED_ORIGIN`.
- Instale dependências (na pasta `server`): `npm install`.
- Inicialize o schema: `npm run db:init`.
- Rode a API: `npm run dev` (porta padrão: 4000).

3) Frontend (Vite + React + Tailwind)
- Na pasta `barbearia`, crie `.env.local` (opcional) com `VITE_API_BASE=http://localhost:4000`.
- Instale dependências: `npm install`.
- Instale Tailwind (dev): `npm i -D tailwindcss postcss autoprefixer` (já referenciadas no `package.json`).
- Rode: `npm run dev` (porta padrão: 5173).
  - Caso não veja estilos, pare o Vite e rode de novo após instalar Tailwind.

4) Fluxos principais
- Cliente: acesse `#/join` (por exemplo `http://localhost:5173/#/join?shop=MINHA_LOJA`), preencha os dados e receba um `ticketId`. Guarde no dispositivo (fica salvo em `localStorage`).
- Status: `#/status` para ver posição na fila e estimativa. Atualiza a cada 10s.
- Painel/Dashboard: `#/dashboard` para a barbearia listar fila e chamar o próximo.

5) QR Code
- Gere um QR que aponta para: `https://SEU_DOMINIO/#/join?shop=CODIGO_DA_LOJA`.
- Exiba o QR impresso ou em uma tela. Ao escanear, o cliente cai direto no formulário para entrar na fila da loja correta.

Notas
- Estimativa simples: 15 minutos por cliente à frente (ajuste no backend conforme sua operação).
- Status possíveis: `waiting`, `called`, `served`, `canceled`.
- Rotas da API: veja `server/src/server.js`.

Painel Admin (separado)
- Painel agora é um app independente em `admin/` (o cliente não tem rota/visibilidade para ele no site público).
- Como rodar:
  - `cd admin && npm install && npm run dev` (porta padrão: 5175)
  - Acesse `http://localhost:5175` e informe o token admin (`ADMIN_TOKEN` do `server/.env`).
- O painel exibe “Senha atual” e a lista em tempo real (SSE) e permite “Chamar próximo”.
