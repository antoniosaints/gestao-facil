-- AlterTable
ALTER TABLE `ArenaQuadras` ADD COLUMN `aprovarSemPagamento` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `intervaloMinimo` INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN `permitirReservaOnline` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `tempoMinimo` INTEGER NOT NULL DEFAULT 60;
