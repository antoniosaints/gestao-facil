# Backend do Gestão Fácil

API principal do sistema, workers assíncronos, integrações externas e partes legadas renderizadas no servidor.

## Stack

- Node.js + TypeScript
- Express 5
- Prisma + MySQL
- Redis + BullMQ
- Socket.IO
- JWT
- Express Handlebars
- Web Push, email, Mercado Pago, Asaas, Gemini e armazenamento S3/R2 compatível

## Estrutura principal

```text
backend/
├── app/
│   ├── controllers/
│   ├── middlewares/
│   ├── queues/
│   ├── routers/
│   ├── schemas/
│   ├── services/
│   ├── utils/
│   ├── workers/
│   └── server.ts
├── prisma/
├── public/
├── views/
├── generated/
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.js
└── package.json
```

Leituras complementares:

- `ARCHITECTURE.md`
- `app/README.md`
- `prisma/README.md`
- `app/controllers/README.md`
- `app/routers/README.md`
- `app/services/README.md`
- `app/workers/README.md`

## Como a aplicação sobe

Entrada principal:

- `app/server.ts`

Esse bootstrap:

- registra o motor Handlebars;
- habilita CORS;
- monta a rota `/api/printer`;
- serve arquivos estáticos de `public/`;
- registra `RouterMain`;
- inicializa Socket.IO;
- escuta a porta definida em `PORT`.

## Scripts disponíveis

```bash
npm run dev              # API em modo watch
npm run build            # build com tsup
npm start                # roda dist/server.js
npm run initialize       # prisma migrate dev
npm run seed             # prisma db seed

npm run email:dev        # worker de email em watch
npm run notification:dev # worker de notificações em watch
npm run cron:dev         # worker de jobs agendados em watch

npm run email            # worker de email em produção
npm run notification     # worker de notificações em produção
npm run cron             # worker de jobs agendados em produção
```

## Dependências de infraestrutura

Para desenvolvimento local, normalmente você precisa de:

- MySQL
- Redis

O projeto inclui `docker-compose.yml` com Redis como apoio operacional, mas a configuração final ainda depende do seu banco e das variáveis de ambiente.

## Variáveis de ambiente

Arquivo de referência inicial:

- `env.example`

Fonte de verdade validada em runtime:

- `app/utils/dotenv.ts`

Atualmente, o backend exige na inicialização variáveis como:

- `DATABASE_URL`
- `BASE_URL`
- `PORT`
- `BASE_URL_FRONTEND`
- `JWT_SECRET`
- `NODE_ENV`
- `REQUIRED_JWT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD`
- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_SECRET`
- `MP_ACCESS_TOKEN`
- `EMAIL_SENDER`
- `EMAIL_PASSWORD`
- `GEMINI_API_KEY`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_ENDPOINT`
- `R2_BUCKET`

> Importante: nem todas as variáveis exigidas pelo validador estão listadas no `env.example`. Se surgir erro de inicialização, consulte `app/utils/dotenv.ts`.

## Setup local

### 1. Instalar dependências

```bash
cd backend
npm install
```

### 2. Configurar `.env`

Preencha as variáveis necessárias com base em `env.example` e em `app/utils/dotenv.ts`.

### 3. Preparar banco

```bash
npm run initialize
npm run seed
```

### 4. Subir a API

```bash
npm run dev
```

### 5. Subir workers, se necessário

```bash
npm run email:dev
npm run notification:dev
npm run cron:dev
```

## Build e produção

### Build

```bash
npm run build
```

### Início manual

```bash
npm start
npm run email
npm run notification
npm run cron
```

### PM2

O arquivo `ecosystem.config.js` já define processos para:

- app principal;
- worker de email;
- worker de notificações.

Exemplo:

```bash
pm2 start ecosystem.config.js
```

## Observações arquiteturais

- A arquitetura é **híbrida**: controllers concentram parte relevante dos casos de uso.
- `services/` existe, mas não é uma camada única obrigatória para toda regra de negócio.
- `views/` e `public/` ainda atendem fluxos ativos.
- `generated/` é gerado pelo Prisma e não deve ser editado manualmente.
- O schema Prisma é grande e multi-tenant via `contaId`.
- No módulo financeiro, os endpoints de acompanhamento e dashboard devem calcular saldo, previsto, atraso e pendências a partir das parcelas financeiras e sempre filtrar pelo `contaId` autenticado.
- O domínio financeiro também expõe criação de lançamentos com parcelamento configurável por período, atualização em cascata de parcelas por escopo e importação em lote por CSV com download de modelo.
- No módulo de produtos, há endpoints que respondem tanto na visão de produto base quanto na visão de variante, dependendo do caso de uso da interface.
- O mesmo domínio também mantém exportações separadas para catálogo/estoque, movimentações de variante, vendas por produto e lucro por produto, com filtros opcionais de período.

## Domínios principais encontrados no código

- autenticação;
- administração e assinantes;
- contas e parâmetros;
- clientes;
- produtos e estoque;
- vendas e comandas;
- financeiro;
- serviços e ordens de serviço;
- arena;
- impressão;
- notificações;
- IA/Gemini;
- integrações com gateways.
