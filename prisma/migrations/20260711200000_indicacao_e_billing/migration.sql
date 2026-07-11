-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `codigoIndicacao` VARCHAR(191) NULL,
    ADD COLUMN `creditoIndicacao` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `indicacaoRecompensada` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `indicadoPorContaId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ParametrosConta` ADD COLUMN `indicacaoAtiva` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `indicacaoTipoBonusIndicado` VARCHAR(191) NULL DEFAULT 'PERCENTUAL',
    ADD COLUMN `indicacaoTipoRecompensa` VARCHAR(191) NULL DEFAULT 'PERCENTUAL',
    ADD COLUMN `indicacaoValorBonusIndicado` DECIMAL(10, 2) NULL DEFAULT 0,
    ADD COLUMN `indicacaoValorRecompensa` DECIMAL(10, 2) NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `IndicacaoRecompensa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `indicadorContaId` INTEGER NOT NULL,
    `indicadoContaId` INTEGER NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `faturaId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IndicacaoRecompensa_indicadorContaId_idx`(`indicadorContaId`),
    INDEX `IndicacaoRecompensa_indicadoContaId_idx`(`indicadoContaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Contas_codigoIndicacao_key` ON `Contas`(`codigoIndicacao`);

-- AddForeignKey
ALTER TABLE `Contas` ADD CONSTRAINT `Contas_indicadoPorContaId_fkey` FOREIGN KEY (`indicadoPorContaId`) REFERENCES `Contas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IndicacaoRecompensa` ADD CONSTRAINT `IndicacaoRecompensa_indicadorContaId_fkey` FOREIGN KEY (`indicadorContaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IndicacaoRecompensa` ADD CONSTRAINT `IndicacaoRecompensa_indicadoContaId_fkey` FOREIGN KEY (`indicadoContaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

