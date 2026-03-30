# Workers

## Papel da pasta
`workers` executa processos assíncronos fora do servidor HTTP principal.

## Processos atuais
- `sendEmailWorker.ts`: consome a fila de email.
- `pushNotificationWorker.ts`: consome a fila de push.
- `cronJobsWorker.ts`: dispara rotinas recorrentes.
- `cron/`: implementações auxiliares de tarefas agendadas.

## Infraestrutura
- Workers usam BullMQ e Redis.
- As filas são definidas em `app/queues`.
- O enfileiramento é acionado por services ou controllers.

## Comportamento importante
- Há limpeza de filas ao iniciar alguns workers com `obliterate`.
- Esse detalhe afeta o comportamento operacional e deve ser levado em conta antes de alterar filas ou replay de jobs.

## Regras
- Worker não deve depender de estado em memória do servidor HTTP.
- Ao criar novo processo assíncrono, documentar fila, produtor, consumidor e requisitos de execução.
