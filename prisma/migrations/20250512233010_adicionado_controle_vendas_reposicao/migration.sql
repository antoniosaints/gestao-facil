/*
  Warnings:

  - Added the required column `contaId` to the `Usuarios` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Usuarios` ADD COLUMN `contaId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `Vendas` MODIFY `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `MovimentacoesEstoque` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `tipo` ENUM('ENTRADA', 'SAIDA', 'DESCARTE', 'TRANSFERENCIA') NOT NULL DEFAULT 'ENTRADA',
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notaFiscal` VARCHAR(191) NULL,
    `status` ENUM('PENDENTE', 'CONCLUIDO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
    `produtoId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL,
    `custo` DECIMAL(10, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PagamentoVendas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendaId` INTEGER NOT NULL,
    `metodo` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NOT NULL DEFAULT 'PIX',
    `valor` DECIMAL(10, 2) NOT NULL,
    `data` DATETIME(3) NULL,
    `status` ENUM('PENDENTE', 'EFETIVADO', 'ESTORNADO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',

    UNIQUE INDEX `PagamentoVendas_vendaId_key`(`vendaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Usuarios` ADD CONSTRAINT `Usuarios_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PagamentoVendas` ADD CONSTRAINT `PagamentoVendas_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
