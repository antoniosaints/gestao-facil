-- Lançamento financeiro automático ao faturar OS (config por conta)
ALTER TABLE `ParametrosConta` ADD COLUMN `osLancamentoAutomatico` BOOLEAN NULL DEFAULT false;
ALTER TABLE `ParametrosConta` ADD COLUMN `osCategoriaFinanceiraId` INTEGER NULL;
ALTER TABLE `ParametrosConta` ADD COLUMN `osContaFinanceiraId` INTEGER NULL;
