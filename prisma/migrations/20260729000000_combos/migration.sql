CREATE TABLE `Combo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `imagem` TEXT NULL,
    `preco` DECIMAL(10, 2) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `mostrarNoPdv` BOOLEAN NOT NULL DEFAULT true,
    `mostrarOnline` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Combo_contaId_Uid_key`(`contaId`, `Uid`),
    UNIQUE INDEX `Combo_id_contaId_key`(`id`, `contaId`),
    INDEX `Combo_contaId_ativo_idx`(`contaId`, `ativo`),
    INDEX `Combo_contaId_mostrarOnline_idx`(`contaId`, `mostrarOnline`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ComboComponente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `comboId` INTEGER NOT NULL,
    `tipo` ENUM('PRODUTO', 'SERVICO') NOT NULL,
    `produtoId` INTEGER NULL,
    `servicoId` INTEGER NULL,
    `quantidade` INTEGER NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ComboComponente_contaId_comboId_idx`(`contaId`, `comboId`),
    INDEX `ComboComponente_produtoId_idx`(`produtoId`),
    INDEX `ComboComponente_servicoId_idx`(`servicoId`),
    UNIQUE INDEX `ComboComponente_comboId_tipo_produtoId_servicoId_key`(`comboId`, `tipo`, `produtoId`, `servicoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ComboSaida` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `comboId` INTEGER NOT NULL,
    `vendaId` INTEGER NULL,
    `ordemServicoId` INTEGER NULL,
    `comandaVendaId` INTEGER NULL,
    `comandaOperacaoId` INTEGER NULL,
    `lojaPedidoId` INTEGER NULL,
    `canal` ENUM('PDV', 'VENDA', 'LOJA', 'OS', 'COMANDA') NOT NULL,
    `nomeSnapshot` VARCHAR(191) NOT NULL,
    `descricaoSnapshot` TEXT NULL,
    `imagemSnapshot` TEXT NULL,
    `precoUnitarioSnapshot` DECIMAL(10, 2) NOT NULL,
    `quantidade` INTEGER NOT NULL,
    `subtotal` DECIMAL(10, 2) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ComboSaida_contaId_comboId_idx`(`contaId`, `comboId`),
    INDEX `ComboSaida_vendaId_idx`(`vendaId`),
    INDEX `ComboSaida_ordemServicoId_idx`(`ordemServicoId`),
    INDEX `ComboSaida_comandaVendaId_idx`(`comandaVendaId`),
    INDEX `ComboSaida_comandaOperacaoId_idx`(`comandaOperacaoId`),
    INDEX `ComboSaida_lojaPedidoId_idx`(`lojaPedidoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ComboSaidaComponente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `comboSaidaId` INTEGER NOT NULL,
    `tipo` ENUM('PRODUTO', 'SERVICO') NOT NULL,
    `produtoId` INTEGER NULL,
    `servicoId` INTEGER NULL,
    `nomeSnapshot` VARCHAR(191) NOT NULL,
    `quantidadePorCombo` INTEGER NOT NULL,
    `quantidadeTotal` INTEGER NOT NULL,
    `valorUnitarioRateado` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `movimentacaoId` INTEGER NULL,
    `debitadoEm` DATETIME(3) NULL,
    `devolvidoEm` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ComboSaidaComponente_movimentacaoId_key`(`movimentacaoId`),
    INDEX `ComboSaidaComponente_contaId_comboSaidaId_idx`(`contaId`, `comboSaidaId`),
    INDEX `ComboSaidaComponente_produtoId_idx`(`produtoId`),
    INDEX `ComboSaidaComponente_servicoId_idx`(`servicoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ComboReservaEstoque` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `pedidoId` INTEGER NOT NULL,
    `comboSaidaComponenteId` INTEGER NOT NULL,
    `produtoId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL,
    `status` ENUM('ATIVA', 'CONFIRMADA', 'CONSUMIDA', 'LIBERADA', 'EXPIRADA') NOT NULL DEFAULT 'ATIVA',
    `expiresAt` DATETIME(3) NULL,
    `consumedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `movimentacaoId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `ComboReservaEstoque_comboSaidaComponenteId_key`(`comboSaidaComponenteId`),
    UNIQUE INDEX `ComboReservaEstoque_movimentacaoId_key`(`movimentacaoId`),
    INDEX `ComboReservaEstoque_contaId_produtoId_status_idx`(`contaId`, `produtoId`, `status`),
    INDEX `ComboReservaEstoque_contaId_status_expiresAt_idx`(`contaId`, `status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Combo` ADD CONSTRAINT `Combo_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboComponente` ADD CONSTRAINT `ComboComponente_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboComponente` ADD CONSTRAINT `ComboComponente_comboId_contaId_fkey` FOREIGN KEY (`comboId`, `contaId`) REFERENCES `Combo`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboComponente` ADD CONSTRAINT `ComboComponente_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboComponente` ADD CONSTRAINT `ComboComponente_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_comboId_fkey` FOREIGN KEY (`comboId`) REFERENCES `Combo`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_ordemServicoId_fkey` FOREIGN KEY (`ordemServicoId`) REFERENCES `OrdensServico`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_comandaVendaId_fkey` FOREIGN KEY (`comandaVendaId`) REFERENCES `ComandaVenda`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_comandaOperacaoId_fkey` FOREIGN KEY (`comandaOperacaoId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaida` ADD CONSTRAINT `ComboSaida_lojaPedidoId_contaId_fkey` FOREIGN KEY (`lojaPedidoId`, `contaId`) REFERENCES `LojaPedido`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaidaComponente` ADD CONSTRAINT `ComboSaidaComponente_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboSaidaComponente` ADD CONSTRAINT `ComboSaidaComponente_comboSaidaId_fkey` FOREIGN KEY (`comboSaidaId`) REFERENCES `ComboSaida`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboSaidaComponente` ADD CONSTRAINT `ComboSaidaComponente_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ComboSaidaComponente` ADD CONSTRAINT `ComboSaidaComponente_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ComboSaidaComponente` ADD CONSTRAINT `ComboSaidaComponente_movimentacaoId_fkey` FOREIGN KEY (`movimentacaoId`) REFERENCES `MovimentacoesEstoque`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ComboReservaEstoque` ADD CONSTRAINT `ComboReservaEstoque_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboReservaEstoque` ADD CONSTRAINT `ComboReservaEstoque_pedidoId_contaId_fkey` FOREIGN KEY (`pedidoId`, `contaId`) REFERENCES `LojaPedido`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboReservaEstoque` ADD CONSTRAINT `ComboReservaEstoque_comboSaidaComponenteId_fkey` FOREIGN KEY (`comboSaidaComponenteId`) REFERENCES `ComboSaidaComponente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComboReservaEstoque` ADD CONSTRAINT `ComboReservaEstoque_produtoId_contaId_fkey` FOREIGN KEY (`produtoId`, `contaId`) REFERENCES `Produto`(`id`, `contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComboReservaEstoque` ADD CONSTRAINT `ComboReservaEstoque_movimentacaoId_fkey` FOREIGN KEY (`movimentacaoId`) REFERENCES `MovimentacoesEstoque`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
