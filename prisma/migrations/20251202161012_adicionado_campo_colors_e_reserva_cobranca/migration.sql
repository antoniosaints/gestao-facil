-- AlterTable
ALTER TABLE `CobrancasFinanceiras` ADD COLUMN `reservaId` INTEGER NULL;

-- AlterTable
ALTER TABLE `ParametrosConta` ADD COLUMN `corPrimaria` VARCHAR(191) NULL,
    ADD COLUMN `corSecundaria` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_reservaId_fkey` FOREIGN KEY (`reservaId`) REFERENCES `ArenaAgendamentos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
