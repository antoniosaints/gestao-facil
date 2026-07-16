-- AlterTable
ALTER TABLE `ParametrosConta`
  ADD COLUMN `inadimplenciaHoraEnvio` INTEGER NULL DEFAULT 10,
  ADD COLUMN `inadimplenciaDiasPadrao` JSON NULL,
  ADD COLUMN `inadimplenciaMensagemPadrao` TEXT NULL;
