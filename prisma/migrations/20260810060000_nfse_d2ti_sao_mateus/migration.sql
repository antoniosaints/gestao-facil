-- Integração D2TI/CTAConsult de São Mateus do Maranhão.
ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `descricaoServicoPadrao` VARCHAR(250) NULL,
  ADD COLUMN `codigoAtividadePadrao` VARCHAR(10) NULL,
  ADD COLUMN `descricaoAtividadePadrao` VARCHAR(250) NULL,
  ADD COLUMN `tipoTributacaoPadrao` INTEGER NULL,
  ADD COLUMN `tipoRecolhimentoPadrao` INTEGER NULL,
  ADD COLUMN `notaIntermediadaPadrao` INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN `tokenIntegracaoCifrado` TEXT NULL,
  ADD COLUMN `tokenIntegracaoAtualizadoEm` DATETIME(3) NULL;

ALTER TABLE `NotaFiscal`
  ADD COLUMN `idempotencyKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `NotaFiscal_contaId_idempotencyKey_key` ON `NotaFiscal`(`contaId`, `idempotencyKey`);
