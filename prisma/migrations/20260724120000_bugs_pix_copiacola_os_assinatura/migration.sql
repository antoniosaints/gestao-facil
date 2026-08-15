-- Feature 2: copia-e-cola (payload PIX) da cobrança Mercado Pago
ALTER TABLE `CobrancasFinanceiras` ADD COLUMN `pixCopiaCola` TEXT NULL;

-- Feature 3: ocultar campos de assinatura no PDF de OS (config por conta)
ALTER TABLE `ParametrosConta` ADD COLUMN `osOcultarAssinatura` BOOLEAN NULL DEFAULT false;

-- Feature 4: relatos de bug enviados pelos usuários, acompanhados pelo CEO
CREATE TABLE `RelatoBug` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NULL,
    `titulo` VARCHAR(160) NOT NULL,
    `descricao` TEXT NOT NULL,
    `severidade` ENUM('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') NOT NULL DEFAULT 'MEDIA',
    `status` ENUM('ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'DESCARTADO') NOT NULL DEFAULT 'ABERTO',
    `rota` VARCHAR(255) NULL,
    `userAgent` VARCHAR(500) NULL,
    `respostaAdmin` TEXT NULL,
    `resolvidoEm` DATETIME(3) NULL,
    `resolvidoPorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RelatoBug_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `RelatoBug_contaId_idx`(`contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RelatoBug` ADD CONSTRAINT `RelatoBug_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RelatoBug` ADD CONSTRAINT `RelatoBug_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RelatoBug` ADD CONSTRAINT `RelatoBug_resolvidoPorId_fkey` FOREIGN KEY (`resolvidoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
