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
- `multer`, `nodemailer`, `web-push`, `mercadopago`, `axios`, `@aws-sdk/client-s3` e `@google/generative-ai` em integrações específicas.

## Entradas e execução
- `app/server.ts` sobe o servidor HTTP, registra handlebars, serve estáticos de `public`, monta rotas, preserva `req.rawBody` no parse JSON para webhooks assinados e inicializa Socket.IO.
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
- notificações push e integrações;
- atendimento WhatsApp via W-API, com instâncias, contatos, conversas, mensagens e eventos de webhook isolados por `contaId`.

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
- Em vendas, gráficos e resumos mensais da dashboard principal devem considerar apenas vendas efetivamente faturadas quando a intenção for refletir faturamento real, evitando misturar status operacionais ainda abertos com receita realizada.
- No financeiro, cálculos de acompanhamento, saldo atual, saldo previsto, atraso, pendência, resumos analíticos legados e DRE devem partir das `ParcelaFinanceiro` e das datas operacionais (`vencimento` e `dataPagamento`), mantendo o `LancamentoFinanceiro` como cabeçalho do agrupamento.
- O mesmo domínio também expõe edição restrita de metadados do lançamento após o registro, sem reabrir valores nem datas, detalhe operacional de conta financeira com resumo consolidado e movimentações filtráveis, transferência entre contas com duas estratégias (gerar lançamentos espelho de entrada/saída ou mover os lançamentos filtrados sem criar novos registros) e ajuste manual de saldo da conta com opção de lançamento financeiro auditável ou recalibração interna do saldo base.
- Os relatórios PDF do DRE mantêm dois layouts distintos, mas compartilham o mesmo consolidado financeiro por parcelas e o cabeçalho visual com a foto/logo da conta quando existir.
- Logo, avatar e demais arquivos públicos devem ser resolvidos via service de storage, nunca assumindo que `Contas.profile` aponta sempre para `./public/...`; a referência pode ser caminho local relativo ou URL pública absoluta baseada em `R2_ENDPOINT`.
- No fluxo de mensalidade do SaaS, o gateway efetivo vem de `Contas.gateway`; o superadmin altera esse padrão em `/admin/configuracoes`, e a mudança sincroniza as contas existentes e o padrão de novos cadastros.
- Quando o gateway selecionado for AbacatePay, o backend cria checkout hospedado, grava a fatura pendente em `FaturasContas` e confirma a renovação via webhook assinado com `ABACATEPAY_WEBHOOK_SECRET` do ambiente.
- O mesmo endpoint de webhook da AbacatePay também atende cobranças operacionais multi-tenant, resolvendo o secret por `ParametrosConta.AbacatePaySecret` e mantendo separado o uso das credenciais globais do SaaS e das credenciais do cliente final.
- O mesmo domínio também centraliza regras reutilizáveis de parcelamento (periodicidade mensal/semanal/diária/quinzenal/personalizada), atualização em cascata por escopo de parcela e importação em lote por CSV.
- As flags operacionais salvas em `ParametrosConta` devem ser tratadas como contrato global do financeiro: criação retroativa, efetivação futura, transferências entre contas e geração de cobrança precisam ser validadas no backend, inclusive quando o fluxo for disparado por vendas, OS, recorrência ou webhooks.
- Sempre que dados do usuário autenticado, da conta ou da assinatura SaaS forem alterados, sincronize os caches Redis usados pela sessão (`infoconta`, `minhaconexao`, `assinaturaconta`) e emita um evento de Socket.IO para que o frontend reflita o estado novo sem depender de refresh manual.
- Tokens e segredos de webhooks do WhatsApp ficam no backend em `WhatsAppInstancia`; endpoints autenticados nunca devem retornar o token bruto, e o webhook público deve validar `webhookSecret` antes de aceitar qualquer payload da W-API.
- Webhooks de WhatsApp devem ser idempotentes por instância/evento, persistir payload bruto em `WhatsAppWebhookEvento`, emitir Socket.IO apenas para `conta:<contaId>` e nunca depender exclusivamente de polling para atualizar a inbox.
- Antes de remover algo de `views` ou `public`, confirmar se a rota ou fluxo legado ainda está em uso.
ainda está em uso.
