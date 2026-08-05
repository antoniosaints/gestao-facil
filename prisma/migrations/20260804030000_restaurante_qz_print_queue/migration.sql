CREATE TABLE IF NOT EXISTS `RestauranteEstacaoImpressao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `nome` VARCHAR(100) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `tokenPrefix` VARCHAR(12) NOT NULL,
  `impressoraNome` VARCHAR(255) NULL,
  `papelReportado` VARCHAR(20) NULL,
  `ativa` BOOLEAN NOT NULL DEFAULT true,
  `online` BOOLEAN NOT NULL DEFAULT false,
  `lastSeenAt` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteEstacaoImpressao_tokenHash_key`(`tokenHash`),
  UNIQUE INDEX `RestauranteEstacaoImpressao_contaId_nome_key`(`contaId`, `nome`),
  INDEX `RestauranteEstacaoImpressao_contaId_ativa_lastSeenAt_idx`(`contaId`, `ativa`, `lastSeenAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RestauranteRegraImpressao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pontoId` INTEGER NOT NULL,
  `estacaoId` INTEGER NOT NULL,
  `fallbackEstacaoId` INTEGER NULL,
  `papel` VARCHAR(20) NOT NULL DEFAULT '80mm',
  `vias` INTEGER NOT NULL DEFAULT 1,
  `imprimirPedidoCompleto` BOOLEAN NOT NULL DEFAULT false,
  `ativa` BOOLEAN NOT NULL DEFAULT true,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteRegraImpressao_pontoId_key`(`pontoId`),
  INDEX `RestauranteRegraImpressao_contaId_ativa_idx`(`contaId`, `ativa`),
  INDEX `RestauranteRegraImpressao_estacaoId_idx`(`estacaoId`),
  INDEX `RestauranteRegraImpressao_fallbackEstacaoId_idx`(`fallbackEstacaoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RestauranteTrabalhoImpressao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(36) NOT NULL,
  `contaId` INTEGER NOT NULL,
  `pontoId` INTEGER NOT NULL,
  `ticketId` INTEGER NOT NULL,
  `estacaoId` INTEGER NOT NULL,
  `fallbackEstacaoId` INTEGER NULL,
  `dedupeKey` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDENTE', 'EM_PROCESSAMENTO', 'CONCLUIDO', 'FALHOU', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  `conteudo` LONGTEXT NOT NULL,
  `formato` VARCHAR(20) NOT NULL DEFAULT 'RAW',
  `papel` VARCHAR(20) NOT NULL DEFAULT '80mm',
  `vias` INTEGER NOT NULL DEFAULT 1,
  `tentativas` INTEGER NOT NULL DEFAULT 0,
  `maxTentativas` INTEGER NOT NULL DEFAULT 3,
  `leaseToken` VARCHAR(36) NULL,
  `leaseExpiresAt` DATETIME(3) NULL,
  `proximaTentativaAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `erro` TEXT NULL,
  `impressoAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteTrabalhoImpressao_uid_key`(`uid`),
  UNIQUE INDEX `RestauranteTrabalhoImpressao_dedupeKey_key`(`dedupeKey`),
  UNIQUE INDEX `RestauranteTrabalhoImpressao_leaseToken_key`(`leaseToken`),
  INDEX `rest_print_job_claim_idx`(`contaId`, `estacaoId`, `status`, `proximaTentativaAt`),
  INDEX `RestauranteTrabalhoImpressao_ticketId_createdAt_idx`(`ticketId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteEstacaoImpressao` ADD CONSTRAINT `RestauranteEstacaoImpressao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteRegraImpressao` ADD CONSTRAINT `RestauranteRegraImpressao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteRegraImpressao` ADD CONSTRAINT `RestauranteRegraImpressao_pontoId_fkey` FOREIGN KEY (`pontoId`) REFERENCES `RestaurantePontoProducao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteRegraImpressao` ADD CONSTRAINT `RestauranteRegraImpressao_estacaoId_fkey` FOREIGN KEY (`estacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteRegraImpressao` ADD CONSTRAINT `RestauranteRegraImpressao_fallbackEstacaoId_fkey` FOREIGN KEY (`fallbackEstacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RestauranteTrabalhoImpressao` ADD CONSTRAINT `RestauranteTrabalhoImpressao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteTrabalhoImpressao` ADD CONSTRAINT `RestauranteTrabalhoImpressao_pontoId_fkey` FOREIGN KEY (`pontoId`) REFERENCES `RestaurantePontoProducao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteTrabalhoImpressao` ADD CONSTRAINT `RestauranteTrabalhoImpressao_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `RestauranteTicketProducao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteTrabalhoImpressao` ADD CONSTRAINT `RestauranteTrabalhoImpressao_estacaoId_fkey` FOREIGN KEY (`estacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteTrabalhoImpressao` ADD CONSTRAINT `RestauranteTrabalhoImpressao_fallbackEstacaoId_fkey` FOREIGN KEY (`fallbackEstacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
