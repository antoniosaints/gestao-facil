-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `cep` VARCHAR(191) NULL,
    ADD COLUMN `emailAvisos` VARCHAR(191) NULL,
    ADD COLUMN `endereco` VARCHAR(191) NULL,
    ADD COLUMN `nomeFantasia` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ParametrosConta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `MercadoPagoApiKey` VARCHAR(191) NULL,
    `AsaasApiKey` VARCHAR(191) NULL,
    `AsaasApiSecret` VARCHAR(191) NULL,
    `MercadoPagoEnv` VARCHAR(191) NULL,
    `AsaasEnv` VARCHAR(191) NULL,
    `eventoVendaConcluida` BOOLEAN NULL DEFAULT true,
    `eventoSangria` BOOLEAN NULL DEFAULT false,
    `eventoEstoqueBaixo` BOOLEAN NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ParametrosConta_contaId_key`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ParametrosConta` ADD CONSTRAINT `ParametrosConta_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
