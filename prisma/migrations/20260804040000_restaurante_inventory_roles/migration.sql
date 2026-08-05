CREATE TABLE `RestauranteUsuarioPapel` (
  `contaId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `papel` ENUM('GESTOR', 'CAIXA', 'GARCOM', 'COZINHA', 'EXPEDICAO') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `rest_user_role_account_idx`(`contaId`, `papel`),
  PRIMARY KEY (`usuarioId`, `papel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestaurantePedidoEstoque` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `pedidoItemId` INTEGER NOT NULL,
  `produtoId` INTEGER NOT NULL,
  `quantidade` INTEGER NOT NULL,
  `status` ENUM('DEBITADO', 'DEVOLVIDO') NOT NULL DEFAULT 'DEBITADO',
  `movimentacaoSaidaId` INTEGER NOT NULL,
  `movimentacaoDevolucaoId` INTEGER NULL,
  `devolvidoAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestaurantePedidoEstoque_movimentacaoSaidaId_key`(`movimentacaoSaidaId`),
  UNIQUE INDEX `RestaurantePedidoEstoque_movimentacaoDevolucaoId_key`(`movimentacaoDevolucaoId`),
  UNIQUE INDEX `RestaurantePedidoEstoque_pedidoItemId_produtoId_key`(`pedidoItemId`, `produtoId`),
  INDEX `rest_order_stock_status_idx`(`contaId`, `pedidoId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteUsuarioPapel` ADD CONSTRAINT `RestauranteUsuarioPapel_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteUsuarioPapel` ADD CONSTRAINT `RestauranteUsuarioPapel_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_pedidoItemId_fkey` FOREIGN KEY (`pedidoItemId`) REFERENCES `RestaurantePedidoItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_movimentacaoSaidaId_fkey` FOREIGN KEY (`movimentacaoSaidaId`) REFERENCES `MovimentacoesEstoque`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoEstoque` ADD CONSTRAINT `RestaurantePedidoEstoque_movimentacaoDevolucaoId_fkey` FOREIGN KEY (`movimentacaoDevolucaoId`) REFERENCES `MovimentacoesEstoque`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
