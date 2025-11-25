/*
  Warnings:

  - You are about to drop the column `intervaloMinimo` on the `ArenaQuadras` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `ArenaQuadras` DROP COLUMN `intervaloMinimo`,
    ADD COLUMN `tempoReserva` INTEGER NOT NULL DEFAULT 60;
