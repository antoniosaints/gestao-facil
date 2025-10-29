-- AlterTable
ALTER TABLE `ParcelaFinanceiro` ADD COLUMN `contaFinanceira` INTEGER NULL,
    ADD COLUMN `descricao` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `ParcelaFinanceiro` ADD CONSTRAINT `ParcelaFinanceiro_contaFinanceira_fkey` FOREIGN KEY (`contaFinanceira`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
