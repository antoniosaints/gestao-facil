CREATE TABLE `RestauranteEntregador` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true,
  `disponivel` BOOLEAN NOT NULL DEFAULT false,
  `ultimaLatitude` DOUBLE NULL,
  `ultimaLongitude` DOUBLE NULL,
  `ultimaLocalizacaoAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteEntregador_usuarioId_key`(`usuarioId`),
  UNIQUE INDEX `RestauranteEntregador_contaId_usuarioId_key`(`contaId`, `usuarioId`),
  INDEX `RestauranteEntregador_contaId_ativo_disponivel_idx`(`contaId`, `ativo`, `disponivel`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteEntrega` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `entregadorId` INTEGER NULL,
  `ofertadaAt` DATETIME(3) NULL,
  `atribuidaAt` DATETIME(3) NULL,
  `retiradaAt` DATETIME(3) NULL,
  `emRotaAt` DATETIME(3) NULL,
  `entregueAt` DATETIME(3) NULL,
  `falhouAt` DATETIME(3) NULL,
  `observacao` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteEntrega_pedidoId_key`(`pedidoId`),
  INDEX `RestauranteEntrega_contaId_entregadorId_updatedAt_idx`(`contaId`, `entregadorId`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteEntregaLocalizacao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `entregaId` INTEGER NOT NULL,
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `precisaoMetros` DOUBLE NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `RestauranteEntregaLocalizacao_contaId_entregaId_createdAt_idx`(`contaId`, `entregaId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteEntregador` ADD CONSTRAINT `RestauranteEntregador_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntregador` ADD CONSTRAINT `RestauranteEntregador_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntrega` ADD CONSTRAINT `RestauranteEntrega_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntrega` ADD CONSTRAINT `RestauranteEntrega_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntrega` ADD CONSTRAINT `RestauranteEntrega_entregadorId_fkey` FOREIGN KEY (`entregadorId`) REFERENCES `RestauranteEntregador`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntregaLocalizacao` ADD CONSTRAINT `RestauranteEntregaLocalizacao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteEntregaLocalizacao` ADD CONSTRAINT `RestauranteEntregaLocalizacao_entregaId_fkey` FOREIGN KEY (`entregaId`) REFERENCES `RestauranteEntrega`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
