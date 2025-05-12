-- AlterTable
ALTER TABLE `Usuarios` ADD COLUMN `emailReceiver` BOOLEAN NULL DEFAULT true,
    ADD COLUMN `pushReceiver` BOOLEAN NULL DEFAULT true;
