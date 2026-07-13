-- CreateTable
CREATE TABLE `WhatsAppAgente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `prompt` TEXT NOT NULL,
    `modelo` VARCHAR(191) NOT NULL DEFAULT 'gemini-2.0-flash',
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `horaInicio` VARCHAR(191) NULL,
    `horaFim` VARCHAR(191) NULL,
    `diasSemana` VARCHAR(191) NOT NULL DEFAULT '0,1,2,3,4,5,6',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WhatsAppAgente_contaId_ativo_idx`(`contaId`, `ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhatsAppAgenteInstancia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `agenteId` INTEGER NOT NULL,
    `instanciaId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WhatsAppAgenteInstancia_contaId_agenteId_idx`(`contaId`, `agenteId`),
    UNIQUE INDEX `WhatsAppAgenteInstancia_contaId_instanciaId_key`(`contaId`, `instanciaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppAgente` ADD CONSTRAINT `WhatsAppAgente_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppAgenteInstancia` ADD CONSTRAINT `WhatsAppAgenteInstancia_agenteId_fkey` FOREIGN KEY (`agenteId`) REFERENCES `WhatsAppAgente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WhatsAppAgenteInstancia` ADD CONSTRAINT `WhatsAppAgenteInstancia_instanciaId_fkey` FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
