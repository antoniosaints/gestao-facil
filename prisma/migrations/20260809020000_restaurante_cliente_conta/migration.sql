CREATE TABLE IF NOT EXISTS `RestauranteClientes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `nome` VARCHAR(160) NOT NULL,
  `telefone` VARCHAR(32) NOT NULL,
  `telefoneNormalizado` VARCHAR(32) NOT NULL,
  `email` VARCHAR(190) NULL,
  `senhaHash` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `RestauranteClientes_contaId_telefoneNormalizado_key`(`contaId`, `telefoneNormalizado`),
  UNIQUE INDEX `RestauranteClientes_id_contaId_key`(`id`, `contaId`),
  INDEX `RestauranteClientes_contaId_telefone_idx`(`contaId`, `telefone`),
  CONSTRAINT `RestauranteClientes_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RestauranteClientesEnderecos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `restauranteClienteId` INTEGER NOT NULL,
  `rotulo` VARCHAR(60) NULL,
  `cep` VARCHAR(8) NOT NULL,
  `cidade` VARCHAR(120) NOT NULL,
  `bairro` VARCHAR(120) NOT NULL,
  `logradouro` VARCHAR(180) NOT NULL,
  `numero` VARCHAR(30) NOT NULL,
  `complemento` VARCHAR(120) NULL,
  `referencia` VARCHAR(180) NULL,
  `principal` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `rest_cliente_end_principal_idx`(`contaId`, `restauranteClienteId`, `principal`),
  CONSTRAINT `RestauranteClientesEnderecos_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RestauranteClientesEnderecos_cliente_fkey` FOREIGN KEY (`restauranteClienteId`, `contaId`) REFERENCES `RestauranteClientes`(`id`, `contaId`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestaurantePedido` ADD COLUMN `restauranteClienteId` INTEGER NULL;
CREATE INDEX `RestaurantePedido_contaId_restauranteClienteId_createdAt_idx` ON `RestaurantePedido`(`contaId`, `restauranteClienteId`, `createdAt`);
ALTER TABLE `RestaurantePedido` ADD CONSTRAINT `RestaurantePedido_cliente_conta_fkey` FOREIGN KEY (`restauranteClienteId`, `contaId`) REFERENCES `RestauranteClientes`(`id`, `contaId`) ON DELETE RESTRICT ON UPDATE CASCADE;
