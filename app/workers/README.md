# Workers

## Papel da pasta
`workers` executa processos assíncronos fora do servidor HTTP principal.

## Processos atuais
- `sendEmailWorker.ts`: consome a fila de email.
- `pushNotificationWorker.ts`: consome a fila de push.
- `whatsappNotificationWorker.ts`: consome a fila de notificações administrativas por WhatsApp.
- `cronJobsWorker.ts`: dispara rotinas recorrentes.
- `cron/recurrencyFinanceWorker.ts`: agenda e processa a geração automática de ciclos/cobranças recorrentes de assinaturas a cada 5 minutos.
- `cron/storeReservationExpirationWorker.ts`: consome a fila `store-reservation-expiration`; o scheduler de `cronJobsWorker.ts` roda a cada minuto e libera, em lotes idempotentes, reservas de pedidos vencidos.
- `cron/`: implementações auxiliares de tarefas agendadas.

## Infraestrutura
- Workers usam BullMQ e Redis.
- A expiração de reservas depende do processo `npm run cron`; retries são seguros porque pedido e reserva só mudam quando ainda estão ativos e vencidos.
- As filas são definidas em `app/queues`.
- O enfileiramento é acionado por services ou controllers.

## Comportamento importante
- Há limpeza de filas ao iniciar alguns workers com `obliterate`.
- Esse detalhe afeta o comportamento operacional e deve ser levado em conta antes de alterar filas ou replay de jobs.

## Regras
- Worker não deve depender de estado em memória do servidor HTTP.
- Ao criar novo processo assíncrono, documentar fila, produtor, consumidor e requisitos de execução.
