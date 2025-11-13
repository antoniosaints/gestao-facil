-- AlterTable
ALTER TABLE `ParametrosConta` ADD COLUMN `cadastrosPermitidosLinkPublico` INTEGER NULL DEFAULT 1,
    ADD COLUMN `linkPublicoAtivo` BOOLEAN NULL DEFAULT false;
