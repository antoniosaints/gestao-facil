ALTER TABLE `ComandaOperacao`
  ADD COLUMN `clienteId` INTEGER NULL,
  ADD COLUMN `clienteNomeSnapshot` VARCHAR(191) NULL;

ALTER TABLE `ComandaOperacaoItem`
  ADD COLUMN `pagamentoId` INTEGER NULL;

CREATE INDEX `ComandaOperacaoItem_pagamentoId_idx` ON `ComandaOperacaoItem`(`pagamentoId`);

ALTER TABLE `ComandaOperacaoItem`
  ADD CONSTRAINT `ComandaOperacaoItem_pagamentoId_fkey`
  FOREIGN KEY (`pagamentoId`) REFERENCES `ComandaOperacaoPagamento`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
