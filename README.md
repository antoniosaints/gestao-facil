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
- Web Push, email, Mercado Pago, AbacatePay, Asaas, Gemini e armazenamento S3/R2 compatível

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
- preserva o corpo bruto em `req.rawBody` durante o parse JSON para validação de webhooks assinados;
- registra `RouterMain`;
- inicializa Socket.IO;
- escuta a porta definida em `PORT`.

## Cobrança da mensalidade SaaS

- A renovação da mensalidade da conta usa o endpoint `GET /api/contas/assinatura/checkout`.
- O gateway dessa renovação vem de `Contas.gateway`, sincronizado globalmente pelo painel do superadmin em `GET/POST /api/admin/configuracoes/gateway`.
- No fluxo AbacatePay da mensalidade SaaS, o backend usa `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET` do ambiente, cria checkout hospedado com métodos `PIX` e `CARD`, grava a fatura pendente em `FaturasContas` e espera confirmação por webhook.
- O mesmo endpoint público `POST /abacatepay/webhook` também trata cobranças operacionais das contas, mas nesse caso valida a assinatura HMAC com o `AbacatePaySecret` salvo em `ParametrosConta` e atualiza `CobrancasFinanceiras`, vendas, parcelas e ciclos recorrentes da conta.
- As credenciais da AbacatePay informadas na App Store da conta (app gratuito `AbacatePay`) pertencem ao tenant e servem apenas para cobranças internas da conta; quando `BASE_URL` é HTTPS, o backend também tenta sincronizar automaticamente a webhook dessa conta na AbacatePay.
- O fluxo legado do Mercado Pago continua disponível no mesmo endpoint genérico como fallback.

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

Variáveis opcionais usadas quando a plataforma habilita mensalidade SaaS via AbacatePay:

- `ABACATEPAY_API_KEY`
- `ABACATEPAY_WEBHOOK_SECRET`

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

O repositório agora inclui a migration `prisma/migrations/20260419110000_assinaturas_modulo_inicial`, que cria o domínio recorrente de planos, assinaturas, ciclos e comodatos.

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
- O backend agora expõe um domínio dedicado `/api/assinaturas`, separado das rotas `/api/contas/assinatura`: as rotas antigas continuam cobrindo a assinatura da própria conta do ERP, enquanto o novo domínio gerencia planos recorrentes de clientes, contratos, ciclos/cobranças, histórico e comodatos.
- Esse mesmo domínio passou a expor endpoints dedicados para listagem tabular e mobile de contratos e planos, mantendo busca, paginação e ordenação compatíveis com o padrão `DataTable` do frontend.
- O fluxo recorrente agora cobre exclusão controlada de planos e assinaturas, geração de cobrança no gateway por ciclo, cancelamento e estorno para PIX/boleto, exclusão segura da cobrança vinculada ao ciclo com exceção operacional para links de pagamento e reajuste com cancelamento da cobrança pendente anterior + recriação automática da nova cobrança.
- Em ciclos recorrentes, a referência do gateway e o link retornado agora ficam vinculados ao próprio ciclo/cobrança financeira, permitindo exibição posterior no detalhe da assinatura e nas listagens operacionais.
- O worker `cronJobsWorker.ts` também passa a processar recorrência de assinaturas, gerando ciclos vencidos a cada 5 minutos via `recurrencyFinanceWorker` e tentando acionar automações financeiras do módulo quando a assinatura estiver configurada para isso, inclusive para link de pagamento quando o gateway suportar o fluxo.
- O domínio de administração agora também expõe controle de apps por conta em `/api/admin/assinantes/:id/apps`, permitindo ao superadmin ativar ou desativar manualmente módulos da App Store — pagos ou gratuitos — como CORE IA, WhatsApp, Assinaturas, Mercado Pago e AbacatePay enquanto a recorrência da conta mantém sincronizado apenas o que impacta cobrança.
- No módulo financeiro, os endpoints de acompanhamento, dashboard, resumos analíticos legados (`totais`, `valor-status`, `valor-conta`, `valor-pagamento`, `resumo-clientes`, `media-mensal`, `categoria`) e DRE devem calcular saldo, previsto, atraso e agregações por categoria a partir das parcelas financeiras, respeitando as datas operacionais (`vencimento` e `dataPagamento`) e sempre filtrando pelo `contaId` autenticado. Isso também vale para gráficos de saldo mensal exibidos em dashboards transversais.
- A listagem principal de lançamentos (`/lancamentos/getDataTable` e `/lancamentos/mobile/data`) agora aceita filtros avançados estruturados por período, tipo, status, conta financeira, categoria e cliente/fornecedor, além da busca textual.
- O mesmo domínio também expõe edição restrita de lançamentos já registrados, permitindo ajustar apenas descrição, categoria, conta financeira, cliente/fornecedor e forma de pagamento padrão, além de um endpoint de detalhe de conta financeira com resumo e movimentações filtráveis por período, tipo, status e busca, uma operação de transferência entre contas com modo de geração financeira ou remanejamento direto dos lançamentos filtrados com prévia de impacto e um ajuste manual de saldo que pode gerar lançamento financeiro ou apenas recalibrar internamente o saldo base da conta.
- Os dois modelos de PDF do DRE financeiro usam esse mesmo consolidado por parcelas e renderizam o cabeçalho com a foto/logo da conta quando disponível, mantendo fallback para a logo padrão.
- O domínio financeiro também expõe criação de lançamentos com parcelamento configurável por período, atualização em cascata de parcelas por escopo e importação em lote por CSV com download de modelo.
- O módulo de ordens de serviço agora expõe faturamento da OS, estorno operacional do faturamento, geração de cobrança vinculada à ordem, bloqueio de exclusão quando existirem cobranças ativas ou status faturado e bloqueio de edição quando a OS já estiver faturada.
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
- assinaturas da conta, assinaturas recorrentes de clientes e integrações com gateways;
- arena;
- impressão;
- notificações;
- IA/Gemini;
- integrações com gateways.
