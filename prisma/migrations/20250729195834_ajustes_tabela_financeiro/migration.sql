/*
  Warnings:

  - You are about to drop the `Parcela` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Parcela` DROP FOREIGN KEY `Parcela_lancamentoId_fkey`;

-- AlterTable
ALTER TABLE `LancamentoFinanceiro` ADD COLUMN `dataEntrada` DATETIME(3) NULL,
    MODIFY `formaPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NOT NULL;

-- DropTable
DROP TABLE `Parcela`;

-- CreateTable
CREATE TABLE `ParcelaFinanceiro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'PAR_000',
    `valor` DECIMAL(65, 30) NOT NULL,
    `vencimento` DATETIME(3) NOT NULL,
    `pago` BOOLEAN NOT NULL DEFAULT false,
    `valorPago` DECIMAL(65, 30) NULL,
    `formaPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NULL,
    `dataPagamento` DATETIME(3) NULL,
    `lancamentoId` INTEGER NOT NULL,

    INDEX `ParcelaFinanceiro_lancamentoId_id_idx`(`lancamentoId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ParcelaFinanceiro` ADD CONSTRAINT `ParcelaFinanceiro_lancamentoId_fkey` FOREIGN KEY (`lancamentoId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
