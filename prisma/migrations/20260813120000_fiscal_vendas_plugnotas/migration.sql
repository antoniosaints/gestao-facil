-- Liga documentos fiscais às vendas e guarda o snapshot que foi autorizado.
ALTER TABLE `NotaFiscal`
  ADD COLUMN `vendaId` INTEGER NULL,
  ADD COLUMN `serie` INTEGER NULL,
  ADD COLUMN `modelo` VARCHAR(20) NULL,
  ADD COLUMN `provedorId` VARCHAR(191) NULL,
  ADD COLUMN `idIntegracao` VARCHAR(191) NULL,
  ADD COLUMN `emitenteSnapshotJson` JSON NULL,
  ADD COLUMN `destinatarioSnapshotJson` JSON NULL,
  ADD COLUMN `tributosSnapshotJson` JSON NULL,
  ADD COLUMN `canceladaEm` DATETIME(3) NULL,
  ADD COLUMN `motivoCancelamento` TEXT NULL;

ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `nfseHabilitado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `nfeHabilitado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `nfceHabilitado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `serieNfe` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `proximoNumeroNfe` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `serieNfce` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `proximoNumeroNfce` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `nfceCscId` VARCHAR(32) NULL,
  ADD COLUMN `nfceCscTokenCifrado` TEXT NULL,
  ADD COLUMN `plugNotasEmpresaId` VARCHAR(191) NULL,
  ADD COLUMN `plugNotasEmpresaAtualizadaEm` DATETIME(3) NULL;

ALTER TABLE `NotaFiscal` MODIFY `clienteId` INTEGER NULL;

CREATE TABLE `NotaFiscalItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `notaFiscalId` INTEGER NOT NULL,
  `produtoId` INTEGER NULL,
  `descricao` VARCHAR(500) NOT NULL,
  `quantidade` DECIMAL(12, 4) NOT NULL,
  `valorUnitario` DECIMAL(12, 4) NOT NULL,
  `valorTotal` DECIMAL(12, 2) NOT NULL,
  `unidade` VARCHAR(12) NULL,
  `ncm` VARCHAR(16) NULL,
  `cest` VARCHAR(16) NULL,
  `cfop` VARCHAR(8) NULL,
  `origem` INTEGER NULL,
  `tributacaoJson` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `NotaFiscalItem_notaFiscalId_idx` (`notaFiscalId`),
  CONSTRAINT `NotaFiscalItem_notaFiscalId_fkey` FOREIGN KEY (`notaFiscalId`) REFERENCES `NotaFiscal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `NotaFiscalEvento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `notaFiscalId` INTEGER NOT NULL,
  `tipo` VARCHAR(40) NOT NULL,
  `status` VARCHAR(40) NOT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `protocolo` VARCHAR(191) NULL,
  `motivo` TEXT NULL,
  `requisicaoJson` JSON NULL,
  `respostaJson` JSON NULL,
  `processadoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `NotaFiscalEvento_notaFiscalId_idempotencyKey_key` (`notaFiscalId`, `idempotencyKey`),
  INDEX `NotaFiscalEvento_notaFiscalId_tipo_status_idx` (`notaFiscalId`, `tipo`, `status`),
  CONSTRAINT `NotaFiscalEvento_notaFiscalId_fkey` FOREIGN KEY (`notaFiscalId`) REFERENCES `NotaFiscal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `NotaFiscal_contaId_vendaId_idx` ON `NotaFiscal`(`contaId`, `vendaId`);
CREATE INDEX `NotaFiscal_contaId_provedorId_idx` ON `NotaFiscal`(`contaId`, `provedorId`);
CREATE UNIQUE INDEX `NotaFiscal_contaId_tipo_serie_numero_key` ON `NotaFiscal`(`contaId`, `tipo`, `serie`, `numero`);

ALTER TABLE `NotaFiscal`
  ADD CONSTRAINT `NotaFiscal_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
