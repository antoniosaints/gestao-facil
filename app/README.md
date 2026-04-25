# Mapa de `app`

## Papel da pasta
`app` contém o código-fonte ativo do backend. Aqui ficam as entradas HTTP, autenticação, regras por domínio, integrações, workers e infraestrutura compartilhada.

## Estrutura principal
- `server.ts`: bootstrap do servidor.
- `config/`: configuração de handlebars e caminhos.
- `controllers/`: handlers HTTP por domínio e subtarefa.
- `external/`: clientes e integrações externas.
- `helpers/`: helpers de contexto e utilidades de domínio.
- `hooks/`: regras auxiliares específicas.
- `mappers/`: tradução de erros e formatos.
- `middlewares/`: autenticação e filtros transversais.
- `queues/`: definição das filas BullMQ.
- `routers/`: roteamento da API.
- `schemas/`: schemas de validação.
- `services/`: serviços especializados e integrações.
- Uploads públicos e leitura de arquivos renderizáveis ficam centralizados em `services/uploads/fileStorageService.ts`, com fallback local e suporte a S3/R2 compatível; fotos da conta e avatar de usuário devem reutilizar esse serviço via `routers/uploads`.
- `types/`: tipos adicionais.
- `utils/`: infraestrutura comum.
- `workers/`: processos assíncronos.

## Convenção real
- A entrada chega por `routers`.
- O controller assume boa parte do caso de uso.
- Serviços aparecem mais em integrações, filas e operações reutilizáveis.
- Prisma, Redis, Socket, JWT e respostas ficam centralizados em `utils`.

## Cuidados
- Não documentar ou implementar essa pasta como se fosse arquitetura em camadas rígidas.
- Ao editar, seguir o domínio existente antes de criar uma nova convenção.
- Nos relatórios, dashboards e resumos legados do financeiro, preferir agregações a partir de `ParcelaFinanceiro` com `Decimal.js`, usando `vencimento`/`dataPagamento` como datas operacionais e deixando `LancamentoFinanceiro` como cabeçalho do agrupamento. Evitar dashboards transversais baseados apenas em `dataLancamento` quando o gráfico pretende refletir comportamento mensal real do caixa.
- No financeiro operacional, edições posteriores do lançamento devem ser restritas a metadados seguros (descrição, categoria, conta, cliente/fornecedor e forma de pagamento padrão), enquanto detalhes completos de conta financeira devem nascer de endpoints dedicados com filtros, resumo consolidado, saldo atual calculado a partir das parcelas pagas, transferência entre contas e ajuste manual de saldo com ou sem reflexo nas listagens financeiras.
- Despesas recorrentes do domínio `assinaturas-pagar` devem ficar separadas do módulo `assinaturas` já existente: o vínculo com `LancamentoFinanceiro` precisa usar origem explícita (`ASSINATURA_PAGAR`), referência de ciclo para idempotência e geração do próximo lançamento apenas após baixa confirmada do atual.
- Caches Redis ligados à sessão/autenticação ficam espalhados por conta e usuário (`infoconta`, `minhaconexao`, `assinaturaconta`); mutações de conta, usuário, mensalidade SaaS e faturas precisam sincronizar esses caches e sinalizar o frontend por socket.
- Preferências operacionais da conta, como flags do financeiro e switches de eventos de notificação, devem ser lidas em serviços centrais antes de permitir uma ação ou enfileirar push.
