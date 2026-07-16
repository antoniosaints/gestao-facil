-- AlterTable: limite mensal padrão de tokens de IA (global do CEO)
ALTER TABLE `IaCoreConfig`
    ADD COLUMN `limiteTokensMensalPadrao` INTEGER NULL;

-- AlterTable: override do limite mensal de tokens por conta
ALTER TABLE `ParametrosConta`
    ADD COLUMN `iaLimiteTokensMensal` INTEGER NULL;

-- CreateTable: consumo de tokens de IA por conta/feature
CREATE TABLE `IaUso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `feature` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'gemini',
    `modelId` VARCHAR(191) NOT NULL,
    `promptTokens` INTEGER NOT NULL DEFAULT 0,
    `completionTokens` INTEGER NOT NULL DEFAULT 0,
    `totalTokens` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IaUso_contaId_createdAt_idx`(`contaId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
