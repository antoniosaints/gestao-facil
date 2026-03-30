-- AlterTable
ALTER TABLE `ComandaVenda` MODIFY `status` ENUM('ABERTA', 'PENDENTE', 'FECHADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA';

-- CreateTable
CREATE TABLE `ComandaItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `comandaId` INTEGER NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `tipo` ENUM('PRODUTO', 'SERVICO') NOT NULL,
    `produtoId` INTEGER NULL,
    `servicoId` INTEGER NULL,
    `quantidade` INTEGER NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `vendaId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ComandaItem` ADD CONSTRAINT `ComandaItem_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaVenda`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaItem` ADD CONSTRAINT `ComandaItem_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaItem` ADD CONSTRAINT `ComandaItem_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaItem` ADD CONSTRAINT `ComandaItem_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
