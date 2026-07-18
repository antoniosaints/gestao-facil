# Workers

## Papel da pasta
`workers` executa processos assíncronos fora do servidor HTTP principal.

## Processos atuais
- `sendEmailWorker.ts`: consome a fila de email.
- `pushNotificationWorker.ts`: consome a fila de push.
- `whatsappNotificationWorker.ts`: consome a fila `whatsapp-notifications` para notificações administrativas e cobranças manuais destinadas a clientes. Cobranças solicitadas por “enviar agora” entram sem delay e usam até três tentativas com backoff.
- `cronJobsWorker.ts`: processo separado que inicializa os workers/schedulers recorrentes; ele não é importado por `server.ts`.
- `cron/financialDueNotificationWorker.ts`: agenda o job horário de vencimentos financeiros; nesse ciclo também processa os lembretes de inadimplência ao cliente, respeitando a hora configurada por conta.
- `cron/recurrencyFinanceWorker.ts`: agenda e processa ciclos recorrentes de assinaturas a cada 10 minutos; na inicialização remove schedulers legados da mesma fila com padrão diferente.
- `cron/storeReservationExpirationWorker.ts`: consome a fila `store-reservation-expiration`; o scheduler de `cronJobsWorker.ts` roda a cada minuto e libera, em lotes idempotentes, reservas de pedidos vencidos.
- `cron/`: implementações auxiliares de tarefas agendadas.

## Infraestrutura
- Workers usam BullMQ e Redis.
- O servidor HTTP (`npm run dev`/`npm run start`) não sobe o cron automaticamente. Em desenvolvimento use `npm run cron:dev`; em produção use `npm run cron` ou o processo `worker-cron` do PM2/Docker Compose.
- A recorrência financeira usa o scheduler `recurrencyFinance` com cron `*/10 * * * *` (10 minutos). Não use cron de 6 campos (ex.: `*/5 * * * * *`), que roda em segundos.
- A expiração de reservas depende do processo `npm run cron`; retries são seguros porque pedido e reserva só mudam quando ainda estão ativos e vencidos.
- As filas são definidas em `app/queues`.
- O enfileiramento é acionado por services ou controllers.

## Comportamento importante
- Há limpeza de filas ao iniciar alguns workers com `obliterate`.
- Esse detalhe afeta o comportamento operacional e deve ser levado em conta antes de alterar filas ou replay de jobs.

## Regras
- Worker não deve depender de estado em memória do servidor HTTP.
- Ao criar novo processo assíncrono, documentar fila, produtor, consumidor e requisitos de execução.
