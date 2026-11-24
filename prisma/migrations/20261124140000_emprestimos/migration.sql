-- AlterTable
ALTER TABLE `LancamentoFinanceiro` MODIFY `origemSistema` ENUM('MANUAL', 'ASSINATURA_PAGAR', 'RESERVA', 'EMPRESTIMO') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `EmprestimoConfiguracao` (
    `contaId` INTEGER NOT NULL,
    `pixManual` BOOLEAN NOT NULL DEFAULT false,
    `mercadoPago` BOOLEAN NOT NULL DEFAULT false,
    `descontoJurosBps` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`contaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Emprestimo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `clienteId` INTEGER NOT NULL,
    `chaveOperacao` VARCHAR(36) NOT NULL,
    `tokenPublico` VARCHAR(64) NOT NULL,
    `principalCentavos` INTEGER NOT NULL,
    `jurosBps` INTEGER NOT NULL,
    `descontoJurosBps` INTEGER NOT NULL,
    `dataSaida` DATETIME(3) NOT NULL,
    `formaSaida` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'CREDIARIO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NOT NULL,
    `contaSaidaId` INTEGER NULL,
    `contaEntradaId` INTEGER NULL,
    `categoriaId` INTEGER NULL,
    `lancamentoAutomatico` BOOLEAN NOT NULL DEFAULT false,
    `lancamentoSaidaId` INTEGER NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Emprestimo_tokenPublico_key`(`tokenPublico`),
    UNIQUE INDEX `Emprestimo_lancamentoSaidaId_key`(`lancamentoSaidaId`),
    INDEX `Emprestimo_contaId_id_idx`(`contaId`, `id`),
    UNIQUE INDEX `Emprestimo_contaId_chaveOperacao_key`(`contaId`, `chaveOperacao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmprestimoParcela` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emprestimoId` INTEGER NOT NULL,
    `numero` INTEGER NOT NULL,
    `vencimento` DATETIME(3) NOT NULL,
    `principalCentavos` INTEGER NOT NULL,
    `jurosCentavos` INTEGER NOT NULL,
    `recebidoCentavos` INTEGER NULL,
    `recebidoEm` DATETIME(3) NULL,
    `pagamentoId` VARCHAR(36) NULL,

    UNIQUE INDEX `EmprestimoParcela_emprestimoId_numero_key`(`emprestimoId`, `numero`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmprestimoPagamento` (
    `id` VARCHAR(36) NOT NULL,
    `emprestimoId` INTEGER NOT NULL,
    `emprestimoAtivoId` INTEGER NULL,
    `chaveOperacao` VARCHAR(36) NULL,
    `metodo` ENUM('PIX_MANUAL', 'MERCADO_PAGO', 'INTERNO') NOT NULL,
    `status` ENUM('PENDENTE', 'EM_ANALISE', 'PAGO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
    `itens` JSON NOT NULL,
    `totalCentavos` INTEGER NOT NULL,
    `pixCopiaCola` TEXT NULL,
    `gatewayId` VARCHAR(191) NULL,
    `gatewaySituacao` VARCHAR(191) NULL,
    `expiraEm` DATETIME(3) NULL,
    `pagadorEmail` VARCHAR(191) NULL,
    `pagadorDocumento` VARCHAR(14) NULL,
    `recebidoEm` DATETIME(3) NULL,
    `formaRecebimento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'CREDIARIO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NULL,
    `lancamentoId` INTEGER NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmprestimoPagamento_emprestimoAtivoId_key`(`emprestimoAtivoId`),
    UNIQUE INDEX `EmprestimoPagamento_gatewayId_key`(`gatewayId`),
    UNIQUE INDEX `EmprestimoPagamento_lancamentoId_key`(`lancamentoId`),
    INDEX `EmprestimoPagamento_emprestimoId_criadoEm_idx`(`emprestimoId`, `criadoEm`),
    UNIQUE INDEX `EmprestimoPagamento_emprestimoId_chaveOperacao_key`(`emprestimoId`, `chaveOperacao`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmprestimoComprovante` (
    `pagamentoId` VARCHAR(36) NOT NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `conteudo` MEDIUMBLOB NOT NULL,
    `enviadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`pagamentoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmprestimoConfiguracao` ADD CONSTRAINT `EmprestimoConfiguracao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_contaSaidaId_fkey` FOREIGN KEY (`contaSaidaId`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_contaEntradaId_fkey` FOREIGN KEY (`contaEntradaId`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Emprestimo` ADD CONSTRAINT `Emprestimo_lancamentoSaidaId_fkey` FOREIGN KEY (`lancamentoSaidaId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmprestimoParcela` ADD CONSTRAINT `EmprestimoParcela_emprestimoId_fkey` FOREIGN KEY (`emprestimoId`) REFERENCES `Emprestimo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmprestimoParcela` ADD CONSTRAINT `EmprestimoParcela_pagamentoId_fkey` FOREIGN KEY (`pagamentoId`) REFERENCES `EmprestimoPagamento`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmprestimoPagamento` ADD CONSTRAINT `EmprestimoPagamento_emprestimoId_fkey` FOREIGN KEY (`emprestimoId`) REFERENCES `Emprestimo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmprestimoPagamento` ADD CONSTRAINT `EmprestimoPagamento_lancamentoId_fkey` FOREIGN KEY (`lancamentoId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmprestimoComprovante` ADD CONSTRAINT `EmprestimoComprovante_pagamentoId_fkey` FOREIGN KEY (`pagamentoId`) REFERENCES `EmprestimoPagamento`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

