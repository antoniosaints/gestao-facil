-- Restaurante e Delivery: fundacao aditiva. A desinstalacao do app nao remove estes dados.
CREATE TABLE `RestauranteConfig` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `slug` VARCHAR(120) NOT NULL,
  `nomePublico` VARCHAR(160) NOT NULL, `ativo` BOOLEAN NOT NULL DEFAULT false, `pedidosQrDireto` BOOLEAN NOT NULL DEFAULT false,
  `modoFrete` ENUM('FIXO','ZONAS') NOT NULL DEFAULT 'FIXO', `taxaFixa` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `freteGratisAcima` DECIMAL(10,2) NULL, `taxaContingencia` DECIMAL(10,2) NULL, `pedidoMinimo` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `horariosJson` JSON NULL, `version` INTEGER NOT NULL DEFAULT 1, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteConfig_contaId_key`(`contaId`), UNIQUE INDEX `RestauranteConfig_slug_key`(`slug`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteCatalogoItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `produtoId` INTEGER NOT NULL, `nomePublico` VARCHAR(160) NULL,
  `descricao` TEXT NULL, `imagem` TEXT NULL, `disponivel` BOOLEAN NOT NULL DEFAULT true,
  `regraPrecoSabores` ENUM('MAIOR_PRECO','MEDIA_PROPORCIONAL','SOMA') NOT NULL DEFAULT 'MAIOR_PRECO', `disponibilidadeJson` JSON NULL,
  `ordem` INTEGER NOT NULL DEFAULT 0, `version` INTEGER NOT NULL DEFAULT 1, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteCatalogoItem_contaId_produtoId_key`(`contaId`,`produtoId`), INDEX `RestauranteCatalogoItem_contaId_disponivel_ordem_idx`(`contaId`,`disponivel`,`ordem`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteGrupoOpcao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `nome` VARCHAR(120) NOT NULL,
  `tipo` ENUM('COMPLEMENTO','SABOR') NOT NULL, `minimo` INTEGER NOT NULL DEFAULT 0, `maximo` INTEGER NOT NULL DEFAULT 1,
  `ativo` BOOLEAN NOT NULL DEFAULT true, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `RestauranteGrupoOpcao_contaId_tipo_ativo_idx`(`contaId`,`tipo`,`ativo`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteOpcao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `grupoId` INTEGER NOT NULL, `produtoId` INTEGER NULL, `nome` VARCHAR(120) NOT NULL,
  `precoAdicional` DECIMAL(10,2) NOT NULL DEFAULT 0, `ativo` BOOLEAN NOT NULL DEFAULT true, `ordem` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `RestauranteOpcao_grupoId_ativo_ordem_idx`(`grupoId`,`ativo`,`ordem`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteCatalogoItemGrupo` (
  `itemId` INTEGER NOT NULL, `grupoId` INTEGER NOT NULL, `ordem` INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (`itemId`,`grupoId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteMesa` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `nome` VARCHAR(80) NOT NULL,
  `status` ENUM('LIVRE','OCUPADA','AGUARDANDO_CONTA','LIMPEZA') NOT NULL DEFAULT 'LIVRE', `qrTokenHash` VARCHAR(64) NULL, `qrTokenPrefix` VARCHAR(12) NULL,
  `ativa` BOOLEAN NOT NULL DEFAULT true, `version` INTEGER NOT NULL DEFAULT 1, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestauranteMesa_qrTokenHash_key`(`qrTokenHash`), UNIQUE INDEX `RestauranteMesa_contaId_nome_key`(`contaId`,`nome`), INDEX `RestauranteMesa_contaId_status_idx`(`contaId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestaurantePedido` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `codigo` VARCHAR(20) NOT NULL,
  `origem` ENUM('BALCAO','MESA','QR_MESA','CARDAPIO','RETIRADA','DELIVERY') NOT NULL,
  `status` ENUM('RECEBIDO','CONFIRMADO','EM_PREPARO','PRONTO','CONCLUIDO','CANCELADO') NOT NULL DEFAULT 'RECEBIDO',
  `producaoStatus` ENUM('PENDENTE','PREPARANDO','PRONTO','ENTREGUE') NOT NULL DEFAULT 'PENDENTE',
  `pagamentoStatus` ENUM('PENDENTE','PAGO','NA_ENTREGA','FALHOU','ESTORNADO','EM_REVISAO') NOT NULL DEFAULT 'PENDENTE',
  `entregaStatus` ENUM('NAO_APLICAVEL','AGUARDANDO_DESPACHO','OFERTADA','ATRIBUIDA','RETIRADA','EM_ROTA','ENTREGUE','FALHOU') NOT NULL DEFAULT 'NAO_APLICAVEL',
  `mesaId` INTEGER NULL, `comandaOperacaoId` INTEGER NULL, `clienteId` INTEGER NULL, `clienteNomeSnapshot` VARCHAR(160) NULL, `clienteTelefone` VARCHAR(32) NULL,
  `enderecoSnapshotJson` JSON NULL, `subtotal` DECIMAL(10,2) NOT NULL, `frete` DECIMAL(10,2) NOT NULL DEFAULT 0, `desconto` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(10,2) NOT NULL, `observacao` TEXT NULL, `trackingTokenHash` VARCHAR(64) NOT NULL, `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL, `concluidoAt` DATETIME(3) NULL, `canceladoAt` DATETIME(3) NULL,
  UNIQUE INDEX `RestaurantePedido_trackingTokenHash_key`(`trackingTokenHash`), UNIQUE INDEX `RestaurantePedido_contaId_codigo_key`(`contaId`,`codigo`),
  INDEX `RestaurantePedido_contaId_status_createdAt_idx`(`contaId`,`status`,`createdAt`), INDEX `RestaurantePedido_contaId_producaoStatus_createdAt_idx`(`contaId`,`producaoStatus`,`createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestaurantePedidoItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `pedidoId` INTEGER NOT NULL, `catalogoItemId` INTEGER NULL, `produtoId` INTEGER NOT NULL,
  `quantidade` DECIMAL(10,3) NOT NULL, `nomeSnapshot` VARCHAR(160) NOT NULL, `precoUnitarioSnapshot` DECIMAL(10,2) NOT NULL,
  `subtotalSnapshot` DECIMAL(10,2) NOT NULL, `tamanhoSnapshot` VARCHAR(80) NULL, `selecoesSnapshotJson` JSON NULL,
  `regraPrecoSnapshot` ENUM('MAIOR_PRECO','MEDIA_PROPORCIONAL','SOMA') NULL, `observacao` TEXT NULL,
  `estoqueDebitado` BOOLEAN NOT NULL DEFAULT false, `quantidadeDebitada` DECIMAL(10,3) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX `RestaurantePedidoItem_pedidoId_idx`(`pedidoId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteIdempotencia` (
  `id` INTEGER NOT NULL AUTO_INCREMENT, `contaId` INTEGER NOT NULL, `chaveHash` VARCHAR(64) NOT NULL, `requestHash` VARCHAR(64) NOT NULL,
  `pedidoId` INTEGER NULL, `respostaJson` JSON NULL, `expiresAt` DATETIME(3) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `RestauranteIdempotencia_contaId_chaveHash_key`(`contaId`,`chaveHash`), INDEX `RestauranteIdempotencia_expiresAt_idx`(`expiresAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteConfig` ADD CONSTRAINT `RestauranteConfig_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteCatalogoItem` ADD CONSTRAINT `RestauranteCatalogoItem_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteCatalogoItem` ADD CONSTRAINT `RestauranteCatalogoItem_produtoId_contaId_fkey` FOREIGN KEY (`produtoId`,`contaId`) REFERENCES `Produto`(`id`,`contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteGrupoOpcao` ADD CONSTRAINT `RestauranteGrupoOpcao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestauranteOpcao` ADD CONSTRAINT `RestauranteOpcao_grupoId_fkey` FOREIGN KEY (`grupoId`) REFERENCES `RestauranteGrupoOpcao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteCatalogoItemGrupo` ADD CONSTRAINT `RestauranteCatalogoItemGrupo_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `RestauranteCatalogoItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteCatalogoItemGrupo` ADD CONSTRAINT `RestauranteCatalogoItemGrupo_grupoId_fkey` FOREIGN KEY (`grupoId`) REFERENCES `RestauranteGrupoOpcao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteMesa` ADD CONSTRAINT `RestauranteMesa_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedido` ADD CONSTRAINT `RestaurantePedido_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedido` ADD CONSTRAINT `RestaurantePedido_mesaId_fkey` FOREIGN KEY (`mesaId`) REFERENCES `RestauranteMesa`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RestaurantePedidoItem` ADD CONSTRAINT `RestaurantePedidoItem_pedidoId_fkey` FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RestauranteIdempotencia` ADD CONSTRAINT `RestauranteIdempotencia_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
