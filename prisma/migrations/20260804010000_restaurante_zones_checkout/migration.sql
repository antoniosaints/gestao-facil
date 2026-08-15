-- Restaurante: zonas de entrega e checkout online. Migration aditiva e sem remocao de dados.
ALTER TABLE `RestauranteConfig`
  ADD COLUMN `retiradaAtiva` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `deliveryAtivo` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `pagamentoOnlineAtivo` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `pagamentoNaEntregaAtivo` BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE `RestauranteZonaEntrega` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `nome` VARCHAR(120) NOT NULL,
  `cidade` VARCHAR(120) NULL,
  `bairrosJson` JSON NULL,
  `cepInicial` VARCHAR(8) NULL,
  `cepFinal` VARCHAR(8) NULL,
  `taxa` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `pedidoMinimo` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `freteGratisAcima` DECIMAL(10,2) NULL,
  `prioridade` INTEGER NOT NULL DEFAULT 0,
  `ativa` BOOLEAN NOT NULL DEFAULT true,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteZonaEntrega_contaId_nome_key`(`contaId`, `nome`),
  INDEX `RestauranteZonaEntrega_contaId_ativa_prioridade_idx`(`contaId`, `ativa`, `prioridade`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteZonaEntrega`
  ADD CONSTRAINT `RestauranteZonaEntrega_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RestaurantePedido`
  ADD COLUMN `clienteEmail` VARCHAR(190) NULL,
  ADD COLUMN `zonaEntregaSnapshotJson` JSON NULL,
  ADD COLUMN `pagamentoMetodoSnapshot` VARCHAR(30) NULL;

ALTER TABLE `CobrancasFinanceiras`
  ADD COLUMN `restaurantePedidoId` INTEGER NULL,
  ADD UNIQUE INDEX `CobrancasFinanceiras_restaurantePedidoId_key`(`restaurantePedidoId`),
  ADD INDEX `CobrancasFinanceiras_contaId_restaurantePedidoId_idx`(`contaId`, `restaurantePedidoId`),
  ADD CONSTRAINT `CobrancasFinanceiras_restaurantePedidoId_fkey`
  FOREIGN KEY (`restaurantePedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
