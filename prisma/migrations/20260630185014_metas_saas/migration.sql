-- CreateTable
CREATE TABLE `Meta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NULL,
    `tipo` ENUM('VENDAS', 'SERVICOS', 'FINANCEIRO') NOT NULL,
    `metrica` ENUM('VALOR', 'QUANTIDADE') NOT NULL DEFAULT 'VALOR',
    `periodicidade` ENUM('MENSAL', 'TRIMESTRAL', 'ANUAL', 'PERSONALIZADO') NOT NULL DEFAULT 'MENSAL',
    `valorAlvo` DECIMAL(12, 2) NOT NULL,
    `dataInicio` DATETIME(3) NOT NULL,
    `dataFim` DATETIME(3) NULL,
    `financeiroTipo` ENUM('RECEITA', 'DESPESA') NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Meta_contaId_tipo_ativo_idx`(`contaId`, `tipo`, `ativo`),
    INDEX `Meta_contaId_periodicidade_dataInicio_idx`(`contaId`, `periodicidade`, `dataInicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Meta` ADD CONSTRAINT `Meta_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
