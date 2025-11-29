-- AlterTable
ALTER TABLE `ParametrosConta` ADD COLUMN `AbacatePayApiKey` VARCHAR(191) NULL,
    ADD COLUMN `AbacatePaySecret` VARCHAR(191) NULL,
    ADD COLUMN `WhatsappAPINumber` VARCHAR(191) NULL,
    ADD COLUMN `WhatsappAPISession` VARCHAR(191) NULL,
    ADD COLUMN `WhatsappAPIToken` VARCHAR(191) NULL,
    ADD COLUMN `chavePix` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Vendas` ADD COLUMN `comandaId` INTEGER NULL;

-- CreateTable
CREATE TABLE `ComandaVenda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `status` ENUM('ABERTA', 'FECHADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA',
    `abertura` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechamento` DATETIME(3) NULL,
    `clienteNome` VARCHAR(191) NOT NULL,
    `observacao` VARCHAR(191) NULL,
    `clienteId` INTEGER NULL,
    `reservaId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComandaPagamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `comandaId` INTEGER NOT NULL,
    `formaPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NOT NULL,
    `valor` DECIMAL(65, 30) NOT NULL,
    `dataPagamento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Vendas` ADD CONSTRAINT `Vendas_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaVenda`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaVenda` ADD CONSTRAINT `ComandaVenda_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaVenda` ADD CONSTRAINT `ComandaVenda_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaVenda` ADD CONSTRAINT `ComandaVenda_reservaId_fkey` FOREIGN KEY (`reservaId`) REFERENCES `ArenaAgendamentos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComandaPagamento` ADD CONSTRAINT `ComandaPagamento_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaVenda`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
