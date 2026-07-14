-- AlterTable
ALTER TABLE `WhatsAppWebhookEvento` ADD COLUMN `telefone` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `WhatsAppWebhookEvento_instanciaId_telefone_idx` ON `WhatsAppWebhookEvento`(`instanciaId`, `telefone`);
