-- Operacao de salao: sessoes de mesa e vinculo com comandas existentes.
CREATE TABLE `RestauranteSessaoMesa` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `mesaId` INTEGER NOT NULL,
  `status` ENUM('ABERTA', 'AGUARDANDO_CONTA', 'FECHADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA',
  `pessoas` INTEGER NOT NULL DEFAULT 1,
  `observacao` TEXT NULL,
  `abertaAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `fechadaAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `RestauranteSessaoMesa_contaId_status_abertaAt_idx`(`contaId`, `status`, `abertaAt`),
  INDEX `RestauranteSessaoMesa_mesaId_status_idx`(`mesaId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteSessaoMesaComanda` (
  `sessaoId` INTEGER NOT NULL,
  `comandaOperacaoId` INTEGER NOT NULL,
  `nome` VARCHAR(80) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `RestauranteSessaoMesaComanda_comandaOperacaoId_key`(`comandaOperacaoId`),
  INDEX `RestauranteSessaoMesaComanda_sessaoId_idx`(`sessaoId`),
  PRIMARY KEY (`sessaoId`, `comandaOperacaoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Pontos de producao e roteamento por categoria.
CREATE TABLE `RestaurantePontoProducao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `nome` VARCHAR(100) NOT NULL,
  `cor` VARCHAR(30) NOT NULL DEFAULT 'orange',
  `ativo` BOOLEAN NOT NULL DEFAULT true,
  `ordem` INTEGER NOT NULL DEFAULT 0,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestaurantePontoProducao_contaId_nome_key`(`contaId`, `nome`),
  INDEX `RestaurantePontoProducao_contaId_ativo_ordem_idx`(`contaId`, `ativo`, `ordem`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteRoteamentoProducao` (
  `pontoId` INTEGER NOT NULL,
  `categoriaId` INTEGER NOT NULL,
  `obrigatorio` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `RestauranteRoteamentoProducao_categoriaId_idx`(`categoriaId`),
  PRIMARY KEY (`pontoId`, `categoriaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteTicketProducao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `pontoId` INTEGER NOT NULL,
  `tipo` ENUM('INICIAL', 'ADICAO', 'CANCELAMENTO') NOT NULL DEFAULT 'INICIAL',
  `status` ENUM('PENDENTE', 'PREPARANDO', 'PRONTO', 'ENTREGUE') NOT NULL DEFAULT 'PENDENTE',
  `sequencia` INTEGER NOT NULL DEFAULT 1,
  `obrigatorio` BOOLEAN NOT NULL DEFAULT true,
  `version` INTEGER NOT NULL DEFAULT 1,
  `iniciadoAt` DATETIME(3) NULL,
  `prontoAt` DATETIME(3) NULL,
  `entregueAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteTicketProducao_pedidoId_pontoId_sequencia_key`(`pedidoId`, `pontoId`, `sequencia`),
  INDEX `RestauranteTicketProducao_contaId_pontoId_status_createdAt_idx`(`contaId`, `pontoId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteTicketItem` (
  `ticketId` INTEGER NOT NULL,
  `pedidoItemId` INTEGER NOT NULL,
  `quantidade` DECIMAL(10, 3) NOT NULL,
  `observacao` TEXT NULL,
  INDEX `RestauranteTicketItem_pedidoItemId_idx`(`pedidoItemId`),
  PRIMARY KEY (`ticketId`, `pedidoItemId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestaurantePedido` ADD COLUMN `sessaoMesaId` INTEGER NULL;
CREATE INDEX `RestaurantePedido_sessaoMesaId_createdAt_idx` ON `RestaurantePedido`(`sessaoMesaId`, `createdAt`);

ALTER TABLE `RestauranteSessaoMesa` ADD CONSTRAINT `RestauranteSessaoMesa_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteSessaoMesa` ADD CONSTRAINT `RestauranteSessaoMesa_mesaId_fkey` FOREIGN KEY (`mesaId`) REFERENCES `RestauranteMesa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteSessaoMesaComanda` ADD CONSTRAINT `RestauranteSessaoMesaComanda_sessaoId_fkey` FOREIGN KEY (`sessaoId`) REFERENCES `RestauranteSessaoMesa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteSessaoMesaComanda` ADD CONSTRAINT `RestauranteSessaoMesaComanda_comandaOperacaoId_fkey` FOREIGN KEY (`comandaOperacaoId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePontoProducao` ADD CONSTRAINT `RestaurantePontoProducao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteRoteamentoProducao` ADD CONSTRAINT `RestauranteRoteamentoProducao_pontoId_fkey` FOREIGN KEY (`pontoId`) REFERENCES `RestaurantePontoProducao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteRoteamentoProducao` ADD CONSTRAINT `RestauranteRoteamentoProducao_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `ProdutoCategoria`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteTicketProducao` ADD CONSTRAINT `RestauranteTicketProducao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteTicketProducao` ADD CONSTRAINT `RestauranteTicketProducao_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteTicketProducao` ADD CONSTRAINT `RestauranteTicketProducao_pontoId_fkey` FOREIGN KEY (`pontoId`) REFERENCES `RestaurantePontoProducao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteTicketItem` ADD CONSTRAINT `RestauranteTicketItem_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `RestauranteTicketProducao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteTicketItem` ADD CONSTRAINT `RestauranteTicketItem_pedidoItemId_fkey` FOREIGN KEY (`pedidoItemId`) REFERENCES `RestaurantePedidoItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedido` ADD CONSTRAINT `RestaurantePedido_comandaOperacaoId_fkey` FOREIGN KEY (`comandaOperacaoId`) REFERENCES `ComandaOperacao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedido` ADD CONSTRAINT `RestaurantePedido_sessaoMesaId_fkey` FOREIGN KEY (`sessaoMesaId`) REFERENCES `RestauranteSessaoMesa`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
