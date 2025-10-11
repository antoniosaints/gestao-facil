-- CreateTable
CREATE TABLE `CobrancasFinanceiras` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `valor` DECIMAL(65, 30) NOT NULL,
    `gateway` VARCHAR(191) NOT NULL,
    `dataVencimento` DATETIME(3) NOT NULL,
    `dataCadastro` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('PENDENTE', 'EFETIVADO', 'ESTORNADO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
    `observacao` VARCHAR(191) NULL,
    `lancamentoId` INTEGER NULL,
    `vendaId` INTEGER NULL,
    `ordemServicoId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_lancamentoId_fkey` FOREIGN KEY (`lancamentoId`) REFERENCES `ParcelaFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_ordemServicoId_fkey` FOREIGN KEY (`ordemServicoId`) REFERENCES `OrdensServico`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
