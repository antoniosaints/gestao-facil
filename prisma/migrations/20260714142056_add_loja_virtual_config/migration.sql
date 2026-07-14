-- CreateTable
CREATE TABLE `LojaVirtualConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `corPrimaria` VARCHAR(191) NOT NULL DEFAULT '#4f46e5',
    `corSecundaria` VARCHAR(191) NOT NULL DEFAULT '#0ea5e9',
    `headerEstilo` VARCHAR(191) NOT NULL DEFAULT 'padrao',
    `bannerUrl` TEXT NULL,
    `bannerTitulo` VARCHAR(191) NULL,
    `bannerSubtitulo` VARCHAR(191) NULL,
    `mensagemBoasVindas` TEXT NULL,
    `mostrarPrecos` BOOLEAN NOT NULL DEFAULT true,
    `pedidoWhatsapp` BOOLEAN NOT NULL DEFAULT true,
    `permitirLogin` BOOLEAN NOT NULL DEFAULT false,
    `permitirCadastro` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LojaVirtualConfig_contaId_key`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LojaVirtualConfig` ADD CONSTRAINT `LojaVirtualConfig_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
