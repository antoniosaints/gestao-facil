-- CreateTable
CREATE TABLE `FaturasContas` (
    `id` VARCHAR(191) NOT NULL,
    `contaId` INTEGER NOT NULL,
    `asaasPaymentId` VARCHAR(191) NOT NULL,
    `vencimento` DATETIME(3) NOT NULL,
    `valor` DOUBLE NOT NULL,
    `status` ENUM('PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FaturasContas_asaasPaymentId_key`(`asaasPaymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FaturasContas` ADD CONSTRAINT `FaturasContas_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
