-- AlterTable
ALTER TABLE `CategoriaFinanceiro` ADD COLUMN `parentId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `CategoriaFinanceiro` ADD CONSTRAINT `CategoriaFinanceiro_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
