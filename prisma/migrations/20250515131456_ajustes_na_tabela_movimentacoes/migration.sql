/*
  Warnings:

  - You are about to drop the `Clientes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Clientes` DROP FOREIGN KEY `Clientes_contaId_fkey`;

-- DropForeignKey
ALTER TABLE `Vendas` DROP FOREIGN KEY `Vendas_clienteId_fkey`;

-- DropIndex
DROP INDEX `Vendas_clienteId_fkey` ON `Vendas`;

-- AlterTable
ALTER TABLE `MovimentacoesEstoque` ADD COLUMN `clienteFornecedor` INTEGER NULL,
    ADD COLUMN `desconto` DECIMAL(10, 2) NULL,
    ADD COLUMN `frete` DECIMAL(10, 2) NULL;

-- DropTable
DROP TABLE `Clientes`;

-- CreateTable
CREATE TABLE `ClientesFornecedores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `status` ENUM('ATIVO', 'INATIVO', 'BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    `nome` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `telefone` VARCHAR(191) NULL,
    `tipo` ENUM('FORNECEDOR', 'CLIENTE') NOT NULL DEFAULT 'CLIENTE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClientesFornecedores` ADD CONSTRAINT `ClientesFornecedores_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_clienteFornecedor_fkey` FOREIGN KEY (`clienteFornecedor`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vendas` ADD CONSTRAINT `Vendas_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
