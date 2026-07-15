-- AlterTable
ALTER TABLE `WhatsAppConversa` ADD COLUMN `filaDesde` DATETIME(3) NULL,
    ADD COLUMN `atendidaEm` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `WhatsAppMensagem` ADD COLUMN `origem` ENUM('CONTATO', 'ATENDENTE', 'AGENTE_IA', 'DISPOSITIVO') NULL,
    ADD COLUMN `usuarioId` INTEGER NULL;

-- CreateTable
CREATE TABLE `WhatsAppConversaEvento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `conversaId` INTEGER NOT NULL,
    `tipo` ENUM('ENFILEIRADA', 'ASSUMIDA', 'FINALIZADA') NOT NULL,
    `usuarioId` INTEGER NULL,
    `referenciaEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WhatsAppConversaEvento_contaId_tipo_createdAt_idx`(`contaId`, `tipo`, `createdAt`),
    INDEX `WhatsAppConversaEvento_contaId_conversaId_createdAt_idx`(`contaId`, `conversaId`, `createdAt`),
    INDEX `WhatsAppConversaEvento_contaId_usuarioId_tipo_createdAt_idx`(`contaId`, `usuarioId`, `tipo`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `WhatsAppConversa_contaId_filaDesde_idx` ON `WhatsAppConversa`(`contaId`, `filaDesde`);

-- CreateIndex
CREATE INDEX `WhatsAppMensagem_contaId_origem_createdAt_idx` ON `WhatsAppMensagem`(`contaId`, `origem`, `createdAt`);

-- CreateIndex
CREATE INDEX `WhatsAppMensagem_contaId_usuarioId_createdAt_idx` ON `WhatsAppMensagem`(`contaId`, `usuarioId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `WhatsAppMensagem` ADD CONSTRAINT `WhatsAppMensagem_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversaEvento` ADD CONSTRAINT `WhatsAppConversaEvento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversaEvento` ADD CONSTRAINT `WhatsAppConversaEvento_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `WhatsAppConversa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppConversaEvento` ADD CONSTRAINT `WhatsAppConversaEvento_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
