-- AlterTable
ALTER TABLE `MovimentacoesEstoque` ADD COLUMN `vendaId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
