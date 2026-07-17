-- CreateTable
CREATE TABLE `AcessoSuporteLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `contaNome` VARCHAR(191) NOT NULL,
    `superAdminId` INTEGER NOT NULL,
    `superAdminNome` VARCHAR(191) NOT NULL,
    `superAdminEmail` VARCHAR(191) NOT NULL,
    `usuarioAlvoId` INTEGER NOT NULL,
    `usuarioAlvoEmail` VARCHAR(191) NOT NULL,
    `motivo` TEXT NOT NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `iniciadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiraEm` DATETIME(3) NOT NULL,
    `encerradoEm` DATETIME(3) NULL,
    `encerradoPor` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AcessoSuporteLog_contaId_idx`(`contaId`),
    INDEX `AcessoSuporteLog_superAdminId_idx`(`superAdminId`),
    INDEX `AcessoSuporteLog_iniciadoEm_idx`(`iniciadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
