-- AlterTable
ALTER TABLE `WhatsAppContato` ADD COLUMN `nomeManual` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `WhatsAppInstancia` ADD COLUMN `atendimentoHoraFim` VARCHAR(191) NULL,
    ADD COLUMN `atendimentoHoraInicio` VARCHAR(191) NULL,
    ADD COLUMN `atendimentoNaoPerturbe` BOOLEAN NOT NULL DEFAULT false;
