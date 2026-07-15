-- CreateTable
CREATE TABLE `LojaSecao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LojaSecao_contaId_idx`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LojaSecaoProduto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `secaoId` INTEGER NOT NULL,
    `produtoBaseId` INTEGER NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LojaSecaoProduto_contaId_idx`(`contaId`),
    INDEX `LojaSecaoProduto_produtoBaseId_idx`(`produtoBaseId`),
    UNIQUE INDEX `LojaSecaoProduto_secaoId_produtoBaseId_key`(`secaoId`, `produtoBaseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LojaSecao` ADD CONSTRAINT `LojaSecao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LojaSecaoProduto` ADD CONSTRAINT `LojaSecaoProduto_secaoId_fkey` FOREIGN KEY (`secaoId`) REFERENCES `LojaSecao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LojaSecaoProduto` ADD CONSTRAINT `LojaSecaoProduto_produtoBaseId_fkey` FOREIGN KEY (`produtoBaseId`) REFERENCES `ProdutoBase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
