CREATE TABLE `ComandaOperacao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `Uid` VARCHAR(6) NOT NULL,
  `contaId` INTEGER NOT NULL,
  `status` ENUM('ABERTA', 'PENDENTE', 'FATURADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA',
  `total` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `observacao` TEXT NULL,
  `abertura` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `fechamento` DATETIME(3) NULL,
  `faturamento` DATETIME(3) NULL,
  `cancelamento` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE UNIQUE INDEX `ComandaOperacao_contaId_Uid_key` ON `ComandaOperacao`(`contaId`, `Uid`);
CREATE INDEX `ComandaOperacao_contaId_status_abertura_idx` ON `ComandaOperacao`(`contaId`, `status`, `abertura`);

CREATE TABLE `ComandaOperacaoItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `comandaId` INTEGER NOT NULL,
  `origemTipo` ENUM('PRODUTO', 'SERVICO', 'AVULSO') NOT NULL,
  `origemId` VARCHAR(64) NULL,
  `nomeSnapshot` VARCHAR(191) NOT NULL,
  `valorUnitarioSnapshot` DECIMAL(10, 2) NOT NULL,
  `quantidade` DECIMAL(10, 3) NOT NULL,
  `subtotal` DECIMAL(10, 2) NOT NULL,
  `estoqueDebitado` BOOLEAN NOT NULL DEFAULT false,
  `quantidadeDebitada` DECIMAL(10, 3) NOT NULL DEFAULT 0,
  `estoqueDevolvido` BOOLEAN NOT NULL DEFAULT false,
  `quantidadeDevolvida` DECIMAL(10, 3) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE INDEX `ComandaOperacaoItem_comandaId_idx` ON `ComandaOperacaoItem`(`comandaId`);
CREATE INDEX `ComandaOperacaoItem_origemTipo_origemId_idx` ON `ComandaOperacaoItem`(`origemTipo`, `origemId`);

CREATE TABLE `ComandaOperacaoPagamento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `comandaId` INTEGER NOT NULL,
  `metodo` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'PROMISSORIA') NOT NULL,
  `valor` DECIMAL(10, 2) NOT NULL,
  `dataPagamento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lancarFinanceiro` BOOLEAN NOT NULL DEFAULT false,
  `financeiroLancamentoIdSnapshot` INTEGER NULL,
  `contaFinanceiraIdSnapshot` INTEGER NULL,
  `categoriaFinanceiraIdSnapshot` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE INDEX `ComandaOperacaoPagamento_comandaId_idx` ON `ComandaOperacaoPagamento`(`comandaId`);

CREATE TABLE `ComandaOperacaoHistorico` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `comandaId` INTEGER NOT NULL,
  `evento` VARCHAR(191) NOT NULL,
  `payloadJson` TEXT NULL,
  `usuarioId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
);

CREATE INDEX `ComandaOperacaoHistorico_comandaId_createdAt_idx` ON `ComandaOperacaoHistorico`(`comandaId`, `createdAt`);

CREATE TABLE `ComandaOperacaoConfiguracao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `contaFinanceiraIdPadrao` INTEGER NULL,
  `categoriaFinanceiraIdPadrao` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
);

CREATE UNIQUE INDEX `ComandaOperacaoConfiguracao_contaId_key` ON `ComandaOperacaoConfiguracao`(`contaId`);

ALTER TABLE `ComandaOperacao` ADD CONSTRAINT `ComandaOperacao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ComandaOperacaoItem` ADD CONSTRAINT `ComandaOperacaoItem_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComandaOperacaoPagamento` ADD CONSTRAINT `ComandaOperacaoPagamento_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComandaOperacaoHistorico` ADD CONSTRAINT `ComandaOperacaoHistorico_comandaId_fkey` FOREIGN KEY (`comandaId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ComandaOperacaoConfiguracao` ADD CONSTRAINT `ComandaOperacaoConfiguracao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
