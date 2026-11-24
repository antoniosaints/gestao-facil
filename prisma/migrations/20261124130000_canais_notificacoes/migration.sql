ALTER TABLE `ParametrosConta`
  ADD COLUMN `emailNotificacoesAtivo` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `emailEventoEstoqueBaixo` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `emailEventoVencimentoFinanceiro` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `pushNotificacoesAtivo` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `pushEventoVencimentoFinanceiro` BOOLEAN NOT NULL DEFAULT true;
