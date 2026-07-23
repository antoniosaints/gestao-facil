-- Onboarding: flag de conclusão do tour de boas-vindas, por conta.
ALTER TABLE `ParametrosConta`
  ADD COLUMN `tourOnboardingConcluido` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: contas já existentes não devem ver o tour automático.
UPDATE `ParametrosConta` SET `tourOnboardingConcluido` = true;
