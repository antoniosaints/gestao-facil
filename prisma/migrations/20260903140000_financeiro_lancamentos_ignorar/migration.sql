ALTER TABLE `LancamentoFinanceiro`
  ADD COLUMN `ignorado` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `ParcelaFinanceiro`
  ADD COLUMN `ignorado` BOOLEAN NOT NULL DEFAULT false;
