-- DropForeignKey
ALTER TABLE `ItensVendas` DROP FOREIGN KEY `ItensVendas_produtoId_fkey`;

-- DropIndex
DROP INDEX `ItensVendas_produtoId_fkey` ON `ItensVendas`;

-- AlterTable
ALTER TABLE `ItensVendas` ADD COLUMN `itemName` VARCHAR(191) NULL,
    ADD COLUMN `servicoId` INTEGER NULL,
    MODIFY `produtoId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `ItensVendas` ADD CONSTRAINT `ItensVendas_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItensVendas` ADD CONSTRAINT `ItensVendas_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
