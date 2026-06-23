-- CreateTable
CREATE TABLE `PdvPonto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `localizacao` VARCHAR(191) NULL,
    `descricao` VARCHAR(191) NULL,
    `status` ENUM('ATIVO', 'INATIVO', 'BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PdvPonto_contaId_status_idx`(`contaId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaixaSessao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `pdvId` INTEGER NULL,
    `codigo` VARCHAR(191) NOT NULL DEFAULT 'CAI_000',
    `status` ENUM('ABERTO', 'FECHADO', 'CANCELADO') NOT NULL DEFAULT 'ABERTO',
    `abertoPorId` INTEGER NOT NULL,
    `fechadoPorId` INTEGER NULL,
    `abertoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechadoEm` DATETIME(3) NULL,
    `saldoInicial` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `saldoEsperado` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `saldoContado` DECIMAL(10, 2) NULL,
    `diferenca` DECIMAL(10, 2) NULL,
    `observacaoAbertura` TEXT NULL,
    `observacaoFechamento` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CaixaSessao_contaId_status_abertoEm_idx`(`contaId`, `status`, `abertoEm`),
    INDEX `CaixaSessao_abertoPorId_status_idx`(`abertoPorId`, `status`),
    INDEX `CaixaSessao_pdvId_idx`(`pdvId`),
    INDEX `CaixaSessao_fechadoPorId_idx`(`fechadoPorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaixaOperador` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `caixaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `entrouEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `saiuEm` DATETIME(3) NULL,

    INDEX `CaixaOperador_contaId_usuarioId_ativo_idx`(`contaId`, `usuarioId`, `ativo`),
    INDEX `CaixaOperador_caixaId_ativo_idx`(`caixaId`, `ativo`),
    INDEX `CaixaOperador_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CaixaMovimento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `caixaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `vendaId` INTEGER NULL,
    `tipo` ENUM('ABERTURA', 'VENDA', 'SANGRIA', 'REFORCO', 'ESTORNO', 'FECHAMENTO') NOT NULL,
    `metodoPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `descricao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CaixaMovimento_contaId_caixaId_tipo_idx`(`contaId`, `caixaId`, `tipo`),
    INDEX `CaixaMovimento_vendaId_idx`(`vendaId`),
    INDEX `CaixaMovimento_caixaId_idx`(`caixaId`),
    INDEX `CaixaMovimento_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Vendas` ADD COLUMN `caixaId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Vendas_caixaId_idx` ON `Vendas`(`caixaId`);

-- AddForeignKey
ALTER TABLE `PdvPonto` ADD CONSTRAINT `PdvPonto_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaSessao` ADD CONSTRAINT `CaixaSessao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaSessao` ADD CONSTRAINT `CaixaSessao_pdvId_fkey` FOREIGN KEY (`pdvId`) REFERENCES `PdvPonto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaSessao` ADD CONSTRAINT `CaixaSessao_abertoPorId_fkey` FOREIGN KEY (`abertoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaSessao` ADD CONSTRAINT `CaixaSessao_fechadoPorId_fkey` FOREIGN KEY (`fechadoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vendas` ADD CONSTRAINT `Vendas_caixaId_fkey` FOREIGN KEY (`caixaId`) REFERENCES `CaixaSessao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaOperador` ADD CONSTRAINT `CaixaOperador_caixaId_fkey` FOREIGN KEY (`caixaId`) REFERENCES `CaixaSessao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaOperador` ADD CONSTRAINT `CaixaOperador_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaMovimento` ADD CONSTRAINT `CaixaMovimento_caixaId_fkey` FOREIGN KEY (`caixaId`) REFERENCES `CaixaSessao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaMovimento` ADD CONSTRAINT `CaixaMovimento_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaixaMovimento` ADD CONSTRAINT `CaixaMovimento_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
