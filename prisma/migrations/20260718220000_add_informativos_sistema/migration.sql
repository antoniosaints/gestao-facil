CREATE TABLE `InformativoSistema` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(120) NOT NULL,
  `mensagem` TEXT NOT NULL,
  `integracao` VARCHAR(60) NOT NULL DEFAULT 'Sistema',
  `severidade` ENUM('INFO', 'ATENCAO', 'INDISPONIBILIDADE') NOT NULL DEFAULT 'INFO',
  `situacao` ENUM('INVESTIGANDO', 'MONITORANDO', 'RESOLVIDO') NOT NULL DEFAULT 'INVESTIGANDO',
  `status` ENUM('RASCUNHO', 'PUBLICADO', 'RESOLVIDO', 'ARQUIVADO') NOT NULL DEFAULT 'RASCUNHO',
  `escopo` ENUM('GLOBAL', 'MODULO', 'CONTAS') NOT NULL DEFAULT 'GLOBAL',
  `moduloCodigo` VARCHAR(80) NULL,
  `inicioEm` DATETIME(3) NULL,
  `fimEm` DATETIME(3) NULL,
  `publicadoEm` DATETIME(3) NULL,
  `resolvidoEm` DATETIME(3) NULL,
  `criadoPorId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `InformativoSistema_status_inicioEm_fimEm_idx`(`status`, `inicioEm`, `fimEm`),
  INDEX `InformativoSistema_escopo_moduloCodigo_idx`(`escopo`, `moduloCodigo`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InformativoConta` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `informativoId` INTEGER NOT NULL,
  `contaId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `InformativoConta_informativoId_contaId_key`(`informativoId`, `contaId`),
  INDEX `InformativoConta_contaId_idx`(`contaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `InformativoLeitura` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `informativoId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `contaId` INTEGER NOT NULL,
  `lidoEm` DATETIME(3) NULL,
  `dispensadoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `InformativoLeitura_informativoId_usuarioId_key`(`informativoId`, `usuarioId`),
  INDEX `InformativoLeitura_contaId_usuarioId_idx`(`contaId`, `usuarioId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `InformativoSistema` ADD CONSTRAINT `InformativoSistema_criadoPorId_fkey` FOREIGN KEY (`criadoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `InformativoConta` ADD CONSTRAINT `InformativoConta_informativoId_fkey` FOREIGN KEY (`informativoId`) REFERENCES `InformativoSistema`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InformativoConta` ADD CONSTRAINT `InformativoConta_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InformativoLeitura` ADD CONSTRAINT `InformativoLeitura_informativoId_fkey` FOREIGN KEY (`informativoId`) REFERENCES `InformativoSistema`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InformativoLeitura` ADD CONSTRAINT `InformativoLeitura_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `InformativoLeitura` ADD CONSTRAINT `InformativoLeitura_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
