-- CreateTable
CREATE TABLE `Servicos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'SER_000',
    `nome` VARCHAR(191) NOT NULL,
    `preco` DECIMAL(10, 2) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `descricao` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrdensServico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'OS_000',
    `descricao` VARCHAR(191) NULL,
    `descricaoCliente` VARCHAR(191) NULL,
    `status` ENUM('ABERTA', 'ORCAMENTO', 'APROVADA', 'ANDAMENTO', 'FATURADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA',
    `garantia` VARCHAR(191) NOT NULL,
    `desconto` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ItensOrdensServico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `itemName` VARCHAR(191) NOT NULL,
    `tipo` ENUM('SERVICO', 'PRODUTO') NOT NULL,
    `ordemId` INTEGER NOT NULL,
    `produtoId` INTEGER NULL,
    `servicoId` INTEGER NULL,
    `quantidade` INTEGER NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assinatura` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clienteId` INTEGER NOT NULL,
    `servicoId` INTEGER NOT NULL,
    `inicio` DATETIME(3) NOT NULL,
    `fim` DATETIME(3) NULL,
    `status` ENUM('ATIVA', 'CANCELADA', 'SUSPENSA') NOT NULL DEFAULT 'ATIVA',
    `recorrencia` ENUM('MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'ANUAL') NOT NULL DEFAULT 'MENSAL',
    `proximaCobranca` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cobranca` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaId` INTEGER NOT NULL,
    `vencimento` DATETIME(3) NOT NULL,
    `pago` BOOLEAN NOT NULL DEFAULT false,
    `valor` DECIMAL(10, 2) NOT NULL,
    `dataPagamento` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Servicos` ADD CONSTRAINT `Servicos_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrdensServico` ADD CONSTRAINT `OrdensServico_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItensOrdensServico` ADD CONSTRAINT `ItensOrdensServico_ordemId_fkey` FOREIGN KEY (`ordemId`) REFERENCES `OrdensServico`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItensOrdensServico` ADD CONSTRAINT `ItensOrdensServico_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ItensOrdensServico` ADD CONSTRAINT `ItensOrdensServico_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assinatura` ADD CONSTRAINT `Assinatura_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assinatura` ADD CONSTRAINT `Assinatura_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cobranca` ADD CONSTRAINT `Cobranca_assinaturaId_fkey` FOREIGN KEY (`assinaturaId`) REFERENCES `Assinatura`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
