-- AlterTable
ALTER TABLE `ParametrosConta`
  ADD COLUMN `vendaLancamentoAutomatico` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `vendaCategoriaFinanceiraId` INTEGER NULL,
  ADD COLUMN `vendaContaFinanceiraId` INTEGER NULL;
