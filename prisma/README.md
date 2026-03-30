# Prisma

## Papel da pasta
`prisma` concentra o modelo de dados, histórico de migrações e seed do backend.

## Arquivos principais
- `schema.prisma`: fonte de verdade do banco.
- `migrations/`: histórico de alterações estruturais.
- `seed.ts`: carga inicial quando necessária.

## Convenções relevantes
- O datasource atual é MySQL.
- O client Prisma é gerado em `backend/generated`.
- Grande parte do sistema é multi-tenant por `contaId`.

## Domínios de dados mais fortes
- contas, usuários e assinatura da conta;
- produtos, estoque e vendas;
- serviços, ordens de serviço e mensagens;
- financeiro, parcelas e cobranças;
- arena, agendamentos, pagamentos e comandas;
- notificações push.

## Regras
- Alterações de schema exigem migration consistente.
- `backend/generated` não deve ser editado manualmente.
- Antes de mudar relações, validar impacto em módulos que compartilham `contaId` e referências cruzadas.
