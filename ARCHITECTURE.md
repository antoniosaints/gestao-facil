# Arquitetura do Backend

## Objetivo
Este backend atende a API principal do sistema, processos assíncronos e partes legadas renderizadas no servidor. A base não segue uma service layer pura: a arquitetura real é híbrida e precisa ser entendida assim.

## Stack principal
- Express 5 com TypeScript.
- Prisma com MySQL.
- BullMQ com Redis para filas e workers.
- Socket.IO para realtime.
- `jsonwebtoken` para autenticação.
- `zod` e `yup` em validação.
- `express-handlebars` para views legadas.
- `multer`, `nodemailer`, `web-push`, `mercadopago`, `@aws-sdk/client-s3` e `@google/generative-ai` em integrações específicas.

## Entradas e execução
- `app/server.ts` sobe o servidor HTTP, registra handlebars, serve estáticos de `public`, monta rotas e inicializa Socket.IO.
- `app/routers/api.ts` agrega os routers principais da API.
- Há processos separados para:
  - servidor web;
  - worker de email;
  - worker de push;
  - worker de cron.

## Organização real
- `app/routers`: entrada HTTP por domínio.
- `app/controllers`: handlers por caso de uso.
- `app/services`: integrações, enfileiramento e regras especializadas.
- `app/schemas`: validação de payloads.
- `app/middlewares`: autenticação e filtros transversais.
- `app/utils`: infraestrutura compartilhada.
- `app/queues` e `app/workers`: processamento assíncrono.
- `prisma`: schema, migrations e seed.
- `views` e `public`: camada legada ainda suportada.
- `generated`: client Prisma gerado.

## Fluxos principais
Fluxo HTTP dominante:

`router -> authenticateJWT -> controller -> prisma/utils/services -> response`

Fluxo assíncrono dominante:

`controller/service -> queue -> worker -> integração externa`

Importante:
- vários controllers acessam Prisma diretamente;
- `services` não concentram toda regra de negócio;
- a separação existe, mas é pragmática e híbrida.

## Modelo de dados
O schema Prisma é grande e multi-tenant por `contaId`. Os domínios mais fortes hoje são:
- contas, usuários e permissões;
- produtos, estoque e vendas;
- serviços, ordens de serviço e assinaturas;
- financeiro, cobranças e parcelas;
- arena, quadras, reservas e comandas;
- notificações push e integrações.

No domínio de produtos, o backend trabalha com duas visões complementares:
- `ProdutoBase`, que representa o cadastro principal e agrega variantes;
- `Produto`, que representa cada variante operacional vendável ou movimentável.
- o mesmo domínio expõe relatórios separados para catálogo/estoque, movimentações de variante, vendas por produto e lucro por produto, sempre filtrados por `contaId` e pelo escopo explícito de produto base ou variante.

## Áreas especiais e legado
- `views/` e `public/` continuam ativos e não podem ser tratados como lixo histórico sem validação.
- `generated/` é artefato do Prisma e não deve ser editado manualmente.
- `uploads/` guarda arquivos operacionais.
- `Dockerfile`, `docker-compose.yml`, `ecosystem.config.js` e `wrangler.toml` fazem parte da infraestrutura de execução/deploy.

## Regras para futuras mudanças
- Não presumir uma camada de serviço obrigatória onde o código atual não segue isso.
- Quando adicionar endpoints, respeitar o agrupamento por domínio em `routers` e `controllers`.
- Sempre considerar o recorte multi-tenant via `contaId`.
- Endpoints analíticos e dashboards devem aplicar o `contaId` do contexto autenticado em toda agregação, groupBy e relação encadeada para impedir mistura de dados entre contas.
- No financeiro, cálculos de acompanhamento, saldo atual, saldo previsto, atraso, pendência, resumos analíticos e DRE devem partir das `ParcelaFinanceiro` e das datas operacionais (`vencimento` e `dataPagamento`), mantendo o `LancamentoFinanceiro` como cabeçalho do agrupamento.
- Os relatórios PDF do DRE mantêm dois layouts distintos, mas compartilham o mesmo consolidado financeiro por parcelas e o cabeçalho visual com a foto/logo da conta quando existir.
- O mesmo domínio também centraliza regras reutilizáveis de parcelamento (periodicidade mensal/semanal/diária/quinzenal/personalizada), atualização em cascata por escopo de parcela e importação em lote por CSV.
- Antes de remover algo de `views` ou `public`, confirmar se a rota ou fluxo legado ainda está em uso.
