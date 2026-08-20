-- CreateTable
CREATE TABLE `RestauranteWhatsAppNotificacao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `pedidoId` INTEGER NOT NULL,
    `evento` VARCHAR(30) NOT NULL,
    `instanciaId` INTEGER NOT NULL,
    `telefone` VARCHAR(32) NOT NULL,
    `mensagem` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `ultimoErro` TEXT NULL,
    `externalMessageId` VARCHAR(191) NULL,
    `respostaApiJson` LONGTEXT NULL,
    `ultimaTentativaEm` DATETIME(3) NULL,
    `enviadaEm` DATETIME(3) NULL,
    `entregueEm` DATETIME(3) NULL,
    `lidoEm` DATETIME(3) NULL,
    `bullJobId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RestauranteWhatsAppNotificacao_bullJobId_key`(`bullJobId`),
    UNIQUE INDEX `RestauranteWhatsAppNotificacao_pedidoId_evento_key`(`pedidoId`, `evento`),
    INDEX `RestauranteWhatsAppNotificacao_contaId_status_updatedAt_idx`(`contaId`, `status`, `updatedAt`),
    INDEX `RestWppNtf_cta_inst_extMsg_idx`(`contaId`, `instanciaId`, `externalMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RestauranteWhatsAppNotificacao` ADD CONSTRAINT `RestauranteWhatsAppNotificacao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RestauranteWhatsAppNotificacao` ADD CONSTRAINT `RestauranteWhatsAppNotificacao_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
