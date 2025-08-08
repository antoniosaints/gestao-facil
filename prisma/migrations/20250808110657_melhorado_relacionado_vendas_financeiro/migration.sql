-- AlterTable
ALTER TABLE `LancamentoFinanceiro` ADD COLUMN `vendaId` INTEGER NULL;

-- AlterTable
ALTER TABLE `Vendas` ADD COLUMN `faturado` BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
