-- Evolução da loja virtual para storefront transacional multi-tenant.
ALTER TABLE `LojaVirtualConfig`
  ADD COLUMN `slug` VARCHAR(191) NULL,
  ADD COLUMN `template` ENUM('ESSENCIAL', 'EDITORIAL', 'IMPACTO') NOT NULL DEFAULT 'ESSENCIAL',
  ADD COLUMN `themeVersion` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `themeConfig` JSON NULL,
  ADD COLUMN `bannerMobileUrl` TEXT NULL,
  ADD COLUMN `mostrarDisponibilidade` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `ocultarEsgotados` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `quickAdd` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `pagamentoOnline` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `gatewayPreferido` ENUM('MERCADOPAGO', 'ABACATEPAY') NULL,
  ADD COLUMN `permitirCheckoutVisitante` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `retiradaAtiva` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `entregaLocalAtiva` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `taxaEntrega` DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN `freteGratisAcima` DECIMAL(10,2) NULL,
  ADD COLUMN `barraAvisoAtiva` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `barraAvisoTexto` VARCHAR(191) NULL;

UPDATE `LojaVirtualConfig`
SET `slug` = CONCAT('loja-', `contaId`)
WHERE `slug` IS NULL;

ALTER TABLE `LojaVirtualConfig`
  MODIFY `slug` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `LojaVirtualConfig_slug_key` ON `LojaVirtualConfig`(`slug`);

CREATE TABLE `LojaCliente` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `clienteId` INTEGER NULL,
  `nome` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `emailNormalizado` VARCHAR(191) NOT NULL,
  `telefone` VARCHAR(191) NULL,
  `senhaHash` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDENTE_VERIFICACAO', 'ATIVO', 'BLOQUEADO') NOT NULL DEFAULT 'PENDENTE_VERIFICACAO',
  `emailVerificadoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LojaCliente_contaId_emailNormalizado_key`(`contaId`, `emailNormalizado`),
  UNIQUE INDEX `LojaCliente_id_contaId_key`(`id`, `contaId`),
  INDEX `LojaCliente_contaId_clienteId_idx`(`contaId`, `clienteId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaClienteSessao` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `lojaClienteId` INTEGER NOT NULL,
  `refreshTokenHash` VARCHAR(191) NOT NULL,
  `userAgent` TEXT NULL,
  `ip` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LojaClienteSessao_refreshTokenHash_key`(`refreshTokenHash`),
  INDEX `LojaClienteSessao_contaId_lojaClienteId_expiresAt_idx`(`contaId`, `lojaClienteId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaClienteToken` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `lojaClienteId` INTEGER NOT NULL,
  `tipo` ENUM('VERIFICACAO_EMAIL', 'REDEFINICAO_SENHA') NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LojaClienteToken_tokenHash_key`(`tokenHash`),
  INDEX `LojaClienteToken_contaId_lojaClienteId_tipo_expiresAt_idx`(`contaId`, `lojaClienteId`, `tipo`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaClienteEndereco` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `lojaClienteId` INTEGER NOT NULL,
  `rotulo` VARCHAR(191) NULL,
  `destinatario` VARCHAR(191) NOT NULL,
  `cep` VARCHAR(191) NOT NULL,
  `endereco` VARCHAR(191) NOT NULL,
  `numero` VARCHAR(191) NOT NULL,
  `complemento` VARCHAR(191) NULL,
  `bairro` VARCHAR(191) NOT NULL,
  `cidade` VARCHAR(191) NOT NULL,
  `estado` VARCHAR(191) NOT NULL,
  `principal` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `LojaClienteEndereco_contaId_lojaClienteId_principal_idx`(`contaId`, `lojaClienteId`, `principal`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaPedido` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `publicId` VARCHAR(191) NOT NULL,
  `accessTokenHash` VARCHAR(191) NOT NULL,
  `Uid` VARCHAR(191) NOT NULL,
  `clienteLojaId` INTEGER NULL,
  `clienteId` INTEGER NULL,
  `vendaId` INTEGER NULL,
  `status` ENUM('RECEBIDO', 'CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'CONCLUIDO', 'CANCELAMENTO_PENDENTE', 'CANCELADO', 'EXPIRADO', 'REVISAO') NOT NULL DEFAULT 'RECEBIDO',
  `pagamentoStatus` ENUM('NAO_APLICAVEL', 'PENDENTE', 'PAGO', 'FALHOU', 'ESTORNADO', 'REVISAO') NOT NULL DEFAULT 'NAO_APLICAVEL',
  `canal` ENUM('WHATSAPP', 'GATEWAY') NOT NULL,
  `gateway` ENUM('MERCADOPAGO', 'ABACATEPAY') NULL,
  `tipoEntrega` ENUM('RETIRADA', 'ENTREGA_LOCAL') NOT NULL,
  `nomeSnapshot` VARCHAR(191) NOT NULL,
  `emailSnapshot` VARCHAR(191) NULL,
  `telefoneSnapshot` VARCHAR(191) NOT NULL,
  `cepSnapshot` VARCHAR(191) NULL,
  `enderecoSnapshot` VARCHAR(191) NULL,
  `numeroSnapshot` VARCHAR(191) NULL,
  `complementoSnapshot` VARCHAR(191) NULL,
  `bairroSnapshot` VARCHAR(191) NULL,
  `cidadeSnapshot` VARCHAR(191) NULL,
  `estadoSnapshot` VARCHAR(191) NULL,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `frete` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(10,2) NOT NULL,
  `observacao` TEXT NULL,
  `reservaExpiraEm` DATETIME(3) NULL,
  `confirmadoEm` DATETIME(3) NULL,
  `pagoEm` DATETIME(3) NULL,
  `preparandoEm` DATETIME(3) NULL,
  `despachadoEm` DATETIME(3) NULL,
  `concluidoEm` DATETIME(3) NULL,
  `canceladoEm` DATETIME(3) NULL,
  `codigoRastreio` VARCHAR(191) NULL,
  `transportadora` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LojaPedido_publicId_key`(`publicId`),
  UNIQUE INDEX `LojaPedido_vendaId_key`(`vendaId`),
  UNIQUE INDEX `LojaPedido_contaId_Uid_key`(`contaId`, `Uid`),
  UNIQUE INDEX `LojaPedido_id_contaId_key`(`id`, `contaId`),
  INDEX `LojaPedido_contaId_status_createdAt_idx`(`contaId`, `status`, `createdAt`),
  INDEX `LojaPedido_contaId_pagamentoStatus_reservaExpiraEm_idx`(`contaId`, `pagamentoStatus`, `reservaExpiraEm`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaPedidoItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `produtoId` INTEGER NOT NULL,
  `produtoNomeSnapshot` VARCHAR(191) NOT NULL,
  `varianteNomeSnapshot` VARCHAR(191) NULL,
  `skuSnapshot` VARCHAR(191) NULL,
  `imagemSnapshot` TEXT NULL,
  `unidadeSnapshot` VARCHAR(191) NULL,
  `precoUnitarioSnapshot` DECIMAL(10,2) NOT NULL,
  `quantidade` INTEGER NOT NULL,
  `subtotal` DECIMAL(10,2) NOT NULL,
  `controlaEstoque` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LojaPedidoItem_id_contaId_key`(`id`, `contaId`),
  INDEX `LojaPedidoItem_contaId_pedidoId_idx`(`contaId`, `pedidoId`),
  INDEX `LojaPedidoItem_contaId_produtoId_idx`(`contaId`, `produtoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaReservaEstoque` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `pedidoItemId` INTEGER NOT NULL,
  `produtoId` INTEGER NOT NULL,
  `quantidade` INTEGER NOT NULL,
  `status` ENUM('ATIVA', 'CONFIRMADA', 'CONSUMIDA', 'LIBERADA', 'EXPIRADA') NOT NULL DEFAULT 'ATIVA',
  `expiresAt` DATETIME(3) NULL,
  `consumedAt` DATETIME(3) NULL,
  `releasedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LojaReservaEstoque_pedidoItemId_key`(`pedidoItemId`),
  INDEX `LojaReservaEstoque_contaId_produtoId_status_idx`(`contaId`, `produtoId`, `status`),
  INDEX `LojaReservaEstoque_contaId_status_expiresAt_idx`(`contaId`, `status`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaCheckoutTentativa` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `pedidoId` INTEGER NOT NULL,
  `gateway` ENUM('MERCADOPAGO', 'ABACATEPAY') NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDENTE', 'PRONTO', 'FALHOU', 'EXPIRADO') NOT NULL DEFAULT 'PENDENTE',
  `referenciaExterna` VARCHAR(191) NULL,
  `checkoutUrl` TEXT NULL,
  `erro` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LojaCheckoutTentativa_contaId_idempotencyKey_key`(`contaId`, `idempotencyKey`),
  INDEX `LojaCheckoutTentativa_contaId_pedidoId_status_idx`(`contaId`, `pedidoId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaWebhookEvento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `provider` ENUM('MERCADOPAGO', 'ABACATEPAY') NOT NULL,
  `eventId` VARCHAR(191) NOT NULL,
  `payload` JSON NULL,
  `processedAt` DATETIME(3) NULL,
  `erro` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `LojaWebhookEvento_contaId_provider_eventId_key`(`contaId`, `provider`, `eventId`),
  INDEX `LojaWebhookEvento_contaId_processedAt_idx`(`contaId`, `processedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LojaIdempotencia` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `escopo` VARCHAR(191) NOT NULL,
  `chave` VARCHAR(191) NOT NULL,
  `requestHash` VARCHAR(191) NOT NULL,
  `recursoTipo` VARCHAR(191) NULL,
  `recursoId` VARCHAR(191) NULL,
  `responseCode` INTEGER NULL,
  `responseBody` JSON NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LojaIdempotencia_contaId_escopo_chave_key`(`contaId`, `escopo`, `chave`),
  INDEX `LojaIdempotencia_contaId_expiresAt_idx`(`contaId`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `Produto_id_contaId_key` ON `Produto`(`id`, `contaId`);

ALTER TABLE `MovimentacoesEstoque`
  ADD COLUMN `reservaLojaId` INTEGER NULL,
  ADD UNIQUE INDEX `MovimentacoesEstoque_reservaLojaId_key`(`reservaLojaId`);

ALTER TABLE `CobrancasFinanceiras`
  ADD COLUMN `pedidoLojaId` INTEGER NULL,
  ADD INDEX `CobrancasFinanceiras_contaId_gateway_idCobranca_idx`(`contaId`, `gateway`, `idCobranca`),
  ADD INDEX `CobrancasFinanceiras_contaId_pedidoLojaId_idx`(`contaId`, `pedidoLojaId`);

ALTER TABLE `LojaCliente` ADD CONSTRAINT `LojaCliente_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaCliente` ADD CONSTRAINT `LojaCliente_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LojaClienteSessao` ADD CONSTRAINT `LojaClienteSessao_lojaClienteId_contaId_fkey` FOREIGN KEY (`lojaClienteId`, `contaId`) REFERENCES `LojaCliente`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaClienteToken` ADD CONSTRAINT `LojaClienteToken_lojaClienteId_contaId_fkey` FOREIGN KEY (`lojaClienteId`, `contaId`) REFERENCES `LojaCliente`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaClienteEndereco` ADD CONSTRAINT `LojaClienteEndereco_lojaClienteId_contaId_fkey` FOREIGN KEY (`lojaClienteId`, `contaId`) REFERENCES `LojaCliente`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaPedido` ADD CONSTRAINT `LojaPedido_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaPedido` ADD CONSTRAINT `LojaPedido_clienteLojaId_contaId_fkey` FOREIGN KEY (`clienteLojaId`, `contaId`) REFERENCES `LojaCliente`(`id`, `contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LojaPedido` ADD CONSTRAINT `LojaPedido_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LojaPedido` ADD CONSTRAINT `LojaPedido_vendaId_fkey` FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `LojaPedidoItem` ADD CONSTRAINT `LojaPedidoItem_pedidoId_contaId_fkey` FOREIGN KEY (`pedidoId`, `contaId`) REFERENCES `LojaPedido`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaPedidoItem` ADD CONSTRAINT `LojaPedidoItem_produtoId_contaId_fkey` FOREIGN KEY (`produtoId`, `contaId`) REFERENCES `Produto`(`id`, `contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LojaReservaEstoque` ADD CONSTRAINT `LojaReservaEstoque_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaReservaEstoque` ADD CONSTRAINT `LojaReservaEstoque_pedidoId_contaId_fkey` FOREIGN KEY (`pedidoId`, `contaId`) REFERENCES `LojaPedido`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaReservaEstoque` ADD CONSTRAINT `LojaReservaEstoque_pedidoItemId_fkey` FOREIGN KEY (`pedidoItemId`) REFERENCES `LojaPedidoItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaReservaEstoque` ADD CONSTRAINT `LojaReservaEstoque_produtoId_contaId_fkey` FOREIGN KEY (`produtoId`, `contaId`) REFERENCES `Produto`(`id`, `contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LojaCheckoutTentativa` ADD CONSTRAINT `LojaCheckoutTentativa_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaCheckoutTentativa` ADD CONSTRAINT `LojaCheckoutTentativa_pedidoId_contaId_fkey` FOREIGN KEY (`pedidoId`, `contaId`) REFERENCES `LojaPedido`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaWebhookEvento` ADD CONSTRAINT `LojaWebhookEvento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `LojaIdempotencia` ADD CONSTRAINT `LojaIdempotencia_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MovimentacoesEstoque` ADD CONSTRAINT `MovimentacoesEstoque_reservaLojaId_fkey` FOREIGN KEY (`reservaLojaId`) REFERENCES `LojaReservaEstoque`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_pedidoLojaId_fkey` FOREIGN KEY (`pedidoLojaId`) REFERENCES `LojaPedido`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
