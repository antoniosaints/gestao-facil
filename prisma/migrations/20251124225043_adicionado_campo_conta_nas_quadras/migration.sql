/*
  Warnings:

  - Added the required column `contaId` to the `ArenaQuadras` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `ArenaQuadras` ADD COLUMN `contaId` INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE `ArenaQuadras` ADD CONSTRAINT `ArenaQuadras_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
