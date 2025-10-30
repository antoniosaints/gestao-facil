-- AlterTable
ALTER TABLE `MovimentacoesEstoque` ADD COLUMN `ordemId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_ordemId_fkey` FOREIGN KEY (`ordemId`) REFERENCES `OrdensServico`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
