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
- Nos relatórios e dashboards financeiros, preferir agregações a partir de `ParcelaFinanceiro` com `Decimal.js`, usando `vencimento`/`dataPagamento` como datas operacionais e deixando `LancamentoFinanceiro` como cabeçalho do agrupamento.
