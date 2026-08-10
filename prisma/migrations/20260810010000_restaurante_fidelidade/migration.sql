CREATE TABLE `RestauranteFidelidadePrograma` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT false,
  `pedidosMeta` INTEGER NOT NULL DEFAULT 6,
  `categoriaIdsJson` JSON NULL,
  `catalogoItemIdsJson` JSON NULL,
  `premioCatalogoItemId` INTEGER NULL,
  `descontoPercentual` DECIMAL(5, 2) NOT NULL DEFAULT 100,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteFidelidadePrograma_contaId_key`(`contaId`),
  INDEX `RestauranteFidelidadePrograma_contaId_ativo_idx`(`contaId`, `ativo`),
  PRIMARY KEY (`id`)
);

CREATE TABLE `RestauranteFidelidadeProgresso` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `telefoneNormalizado` VARCHAR(32) NOT NULL,
  `clienteNome` VARCHAR(160) NULL,
  `pedidosElegiveis` INTEGER NOT NULL DEFAULT 0,
  `recompensasDisponiveis` INTEGER NOT NULL DEFAULT 0,
  `recompensasEmitidas` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `rest_fidelidade_progress_phone_uq`(`contaId`, `telefoneNormalizado`),
  INDEX `rest_fidelidade_progress_rewards_idx`(`contaId`, `recompensasDisponiveis`),
  PRIMARY KEY (`id`)
);

CREATE TABLE `RestauranteFidelidadeLancamento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `progressoId` INTEGER NOT NULL,
  `deltaPedidos` INTEGER NOT NULL DEFAULT 1,
  `recompensaNova` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `RestauranteFidelidadeLancamento_pedidoId_key`(`pedidoId`),
  INDEX `rest_fidelidade_ledger_progress_idx`(`contaId`, `progressoId`),
  PRIMARY KEY (`id`)
);

ALTER TABLE `RestauranteFidelidadePrograma`
  ADD CONSTRAINT `rest_fidelidade_programa_conta_fk` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rest_fidelidade_programa_premio_fk` FOREIGN KEY (`premioCatalogoItemId`) REFERENCES `RestauranteCatalogoItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RestauranteFidelidadeProgresso`
  ADD CONSTRAINT `rest_fidelidade_progresso_conta_fk` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteFidelidadeLancamento`
  ADD CONSTRAINT `rest_fidelidade_lancamento_conta_fk` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rest_fidelidade_lancamento_pedido_fk` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
