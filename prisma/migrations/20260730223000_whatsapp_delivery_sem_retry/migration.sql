UPDATE `WhatsAppWebhookEvento`
SET
    `status` = 'IGNORADO',
    `processado` = true,
    `processedAt` = COALESCE(`processedAt`, CURRENT_TIMESTAMP(3)),
    `motivoIgnorado` = 'delivery-de-envio-nao-rastreado',
    `erro` = NULL,
    `proximaTentativaEm` = NULL,
    `bloqueadoEm` = NULL,
    `workerId` = NULL,
    `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE
    `tipo` = 'delivery'
    AND `status` IN ('PENDENTE', 'PROCESSANDO', 'FALHOU')
    AND `erro` LIKE 'Mensagem referenciada pelo delivery ainda não foi persistida%';
