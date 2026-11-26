CREATE TABLE `EmprestimoLembrete` (
    `emprestimoId` INTEGER NOT NULL,
    `instanciaId` INTEGER NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT false,
    `diasLembrete` JSON NOT NULL,
    `mensagemCustom` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `emprestimo_lembrete_instancia_idx` (`instanciaId`),
    INDEX `emprestimo_lembrete_ativo_idx` (`ativo`),
    PRIMARY KEY (`emprestimoId`),
    CONSTRAINT `EmprestimoLembrete_emprestimoId_fkey` FOREIGN KEY (`emprestimoId`) REFERENCES `Emprestimo` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `EmprestimoLembrete_instanciaId_fkey` FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `EmprestimoLembreteEnviado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parcelaId` INTEGER NOT NULL,
    `diaOffset` INTEGER NOT NULL,
    `dataReferencia` DATETIME(3) NOT NULL,
    `enviadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `emprestimo_lembrete_enviado_unique` (`parcelaId`, `diaOffset`, `dataReferencia`),
    PRIMARY KEY (`id`),
    CONSTRAINT `EmprestimoLembreteEnviado_parcelaId_fkey` FOREIGN KEY (`parcelaId`) REFERENCES `EmprestimoParcela` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
