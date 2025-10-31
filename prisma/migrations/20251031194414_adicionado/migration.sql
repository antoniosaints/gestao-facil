-- AlterTable
ALTER TABLE `Produto` ADD COLUMN `controlaEstoque` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `custoMedioProducao` DECIMAL(10, 2) NULL,
    ADD COLUMN `producaoLocal` BOOLEAN NULL DEFAULT false;
