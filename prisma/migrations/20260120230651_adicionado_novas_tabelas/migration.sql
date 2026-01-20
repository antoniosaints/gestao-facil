-- AlterTable
ALTER TABLE `FaturasContas` ADD COLUMN `descricao` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ModulosAdicionais` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NULL,
    `categoria` VARCHAR(191) NOT NULL,
    `preco` DECIMAL(10, 2) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `desconto` DECIMAL(10, 2) NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModuloOnConta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vencimento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `moduloId` INTEGER NOT NULL,
    `contaId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ModuloOnConta_moduloId_contaId_key`(`moduloId`, `contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ModuloOnConta` ADD CONSTRAINT `ModuloOnConta_moduloId_fkey` FOREIGN KEY (`moduloId`) REFERENCES `ModulosAdicionais`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModuloOnConta` ADD CONSTRAINT `ModuloOnConta_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
