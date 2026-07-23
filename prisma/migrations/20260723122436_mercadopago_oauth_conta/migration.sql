-- CreateTable
CREATE TABLE `MercadoPagoOAuthConta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `mpUserId` VARCHAR(191) NOT NULL,
    `accessTokenEnc` TEXT NOT NULL,
    `refreshTokenEnc` TEXT NOT NULL,
    `publicKey` VARCHAR(191) NULL,
    `scope` VARCHAR(191) NULL,
    `liveMode` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NOT NULL,
    `ultimaRenovacaoEm` DATETIME(3) NULL,
    `ultimoErro` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MercadoPagoOAuthConta_contaId_key`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MercadoPagoOAuthConta` ADD CONSTRAINT `MercadoPagoOAuthConta_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
