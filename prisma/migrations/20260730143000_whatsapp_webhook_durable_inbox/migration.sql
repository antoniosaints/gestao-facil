CREATE TABLE `WhatsAppWebhookWorkerEstado` (
    `id` INTEGER NOT NULL,
    `workerId` VARCHAR(191) NOT NULL,
    `heartbeatAt` DATETIME(3) NOT NULL,
    `ultimoProcessadoEm` DATETIME(3) NULL,
    `ultimoErro` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppWebhookEvento`
    ADD COLUMN `status` ENUM('PENDENTE', 'PROCESSANDO', 'PROCESSADO', 'IGNORADO', 'FALHOU') NOT NULL DEFAULT 'PENDENTE',
    ADD COLUMN `tentativas` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `proximaTentativaEm` DATETIME(3) NULL,
    ADD COLUMN `bloqueadoEm` DATETIME(3) NULL,
    ADD COLUMN `workerId` VARCHAR(191) NULL,
    ADD COLUMN `partitionKey` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `motivoIgnorado` TEXT NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NULL;

UPDATE `WhatsAppWebhookEvento`
SET
    `status` = CASE WHEN `processado` = true THEN 'PROCESSADO' ELSE 'FALHOU' END,
    `partitionKey` = CONCAT(`instanciaId`, ':legacy'),
    `updatedAt` = CURRENT_TIMESTAMP(3),
    `erro` = CASE
      WHEN `processado` = false AND (`erro` IS NULL OR `erro` = '') THEN 'Evento legado pendente de revisao manual'
      ELSE `erro`
    END;

ALTER TABLE `WhatsAppWebhookEvento`
    MODIFY COLUMN `updatedAt` DATETIME(3) NOT NULL,
    DROP INDEX `WhatsAppWebhookEvento_instanciaId_eventId_key`,
    ADD UNIQUE INDEX `WhatsAppWebhookEvento_instanciaId_tipo_eventId_key`(`instanciaId`, `tipo`, `eventId`),
    ADD INDEX `WhatsAppWebhookEvento_status_proximaTentativaEm_createdAt_idx`(`status`, `proximaTentativaEm`, `createdAt`),
    ADD INDEX `WhatsAppWebhookEvento_partitionKey_status_createdAt_idx`(`partitionKey`, `status`, `createdAt`);
