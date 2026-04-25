/*
  Warnings:

  - A unique constraint covering the columns `[assinaturaPagarId,referenciaRecorrencia]` on the table `LancamentoFinanceiro` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `LancamentoFinanceiro` ADD COLUMN `assinaturaPagarId` INTEGER NULL,
    ADD COLUMN `origemSistema` ENUM('MANUAL', 'ASSINATURA_PAGAR') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `referenciaRecorrencia` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AssinaturaPagar` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'ASP_000',
    `nomeServico` VARCHAR(191) NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `periodicidade` ENUM('SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL', 'PERSONALIZADO') NOT NULL DEFAULT 'MENSAL',
    `intervaloDiasPersonalizado` INTEGER NULL,
    `inicio` DATETIME(3) NOT NULL,
    `fim` DATETIME(3) NULL,
    `proximoVencimento` DATETIME(3) NULL,
    `status` ENUM('ATIVA', 'INATIVA', 'CANCELADA') NOT NULL DEFAULT 'ATIVA',
    `gerarFinanceiro` BOOLEAN NOT NULL DEFAULT false,
    `gerarAutomatico` BOOLEAN NOT NULL DEFAULT false,
    `contaFinanceiraId` INTEGER NULL,
    `categoriaId` INTEGER NULL,
    `formaPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NULL,
    `icone` VARCHAR(191) NULL,
    `corDestaque` VARCHAR(191) NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AssinaturaPagar_contaId_status_proximoVencimento_idx`(`contaId`, `status`, `proximoVencimento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaPagarLink` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaPagarId` INTEGER NOT NULL,
    `titulo` VARCHAR(191) NOT NULL,
    `url` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `LancamentoFinanceiro_assinaturaPagarId_referenciaRecorrencia_key` ON `LancamentoFinanceiro`(`assinaturaPagarId`, `referenciaRecorrencia`);

-- AddForeignKey
ALTER TABLE `AssinaturaPagar` ADD CONSTRAINT `AssinaturaPagar_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaPagar` ADD CONSTRAINT `AssinaturaPagar_contaFinanceiraId_fkey` FOREIGN KEY (`contaFinanceiraId`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaPagar` ADD CONSTRAINT `AssinaturaPagar_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaPagarLink` ADD CONSTRAINT `AssinaturaPagarLink_assinaturaPagarId_fkey` FOREIGN KEY (`assinaturaPagarId`) REFERENCES `AssinaturaPagar`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_assinaturaPagarId_fkey` FOREIGN KEY (`assinaturaPagarId`) REFERENCES `AssinaturaPagar`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
