-- CreateTable
CREATE TABLE `Clientes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `telefone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vendas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `data` DATETIME(3) NOT NULL,
    `valor` DOUBLE NOT NULL,
    `clienteId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Clientes` ADD CONSTRAINT `Clientes_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vendas` ADD CONSTRAINT `Vendas_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vendas` ADD CONSTRAINT `Vendas_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `Clientes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
