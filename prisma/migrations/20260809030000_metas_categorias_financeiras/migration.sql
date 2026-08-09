-- CreateTable
CREATE TABLE `MetaCategoriaFinanceiro` (
    `metaId` INTEGER NOT NULL,
    `categoriaId` INTEGER NOT NULL,

    INDEX `MetaCategoriaFinanceiro_categoriaId_idx`(`categoriaId`),
    PRIMARY KEY (`metaId`, `categoriaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MetaCategoriaFinanceiro` ADD CONSTRAINT `MetaCategoriaFinanceiro_metaId_fkey` FOREIGN KEY (`metaId`) REFERENCES `Meta`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MetaCategoriaFinanceiro` ADD CONSTRAINT `MetaCategoriaFinanceiro_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
