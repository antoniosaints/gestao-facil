CREATE TABLE `RestauranteCaixaSessao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `codigo` VARCHAR(30) NOT NULL,
    `status` ENUM('ABERTO', 'FECHADO', 'CANCELADO') NOT NULL DEFAULT 'ABERTO',
    `abertoPorId` INTEGER NOT NULL,
    `fechadoPorId` INTEGER NULL,
    `abertoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechadoEm` DATETIME(3) NULL,
    `saldoInicial` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `saldoEsperado` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `saldoContado` DECIMAL(10, 2) NULL,
    `diferenca` DECIMAL(10, 2) NULL,
    `fechamentoMetodos` JSON NULL,
    `observacaoAbertura` TEXT NULL,
    `observacaoFechamento` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RestauranteCaixaSessao_codigo_key`(`codigo`),
    INDEX `RestauranteCaixaSessao_contaId_status_abertoEm_idx`(`contaId`, `status`, `abertoEm`),
    INDEX `RestauranteCaixaSessao_abertoPorId_status_idx`(`abertoPorId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RestauranteCaixaMovimento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `caixaId` INTEGER NOT NULL,
    `usuarioId` INTEGER NOT NULL,
    `tipo` ENUM('ABERTURA', 'VENDA', 'SANGRIA', 'REFORCO', 'ESTORNO', 'FECHAMENTO') NOT NULL,
    `metodoPagamento` VARCHAR(30) NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `descricao` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RestauranteCaixaMovimento_contaId_caixaId_tipo_idx`(`contaId`, `caixaId`, `tipo`),
    INDEX `RestauranteCaixaMovimento_usuarioId_idx`(`usuarioId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestaurantePedido` ADD COLUMN `restauranteCaixaId` INTEGER NULL;
CREATE INDEX `RestaurantePedido_restauranteCaixaId_idx` ON `RestaurantePedido`(`restauranteCaixaId`);

ALTER TABLE `RestauranteCaixaSessao`
    ADD CONSTRAINT `RestauranteCaixaSessao_contaId_fkey`
    FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `RestauranteCaixaSessao_abertoPorId_fkey`
    FOREIGN KEY (`abertoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `RestauranteCaixaSessao_fechadoPorId_fkey`
    FOREIGN KEY (`fechadoPorId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RestauranteCaixaMovimento`
    ADD CONSTRAINT `RestauranteCaixaMovimento_contaId_fkey`
    FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `RestauranteCaixaMovimento_caixaId_fkey`
    FOREIGN KEY (`caixaId`) REFERENCES `RestauranteCaixaSessao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `RestauranteCaixaMovimento_usuarioId_fkey`
    FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RestaurantePedido`
    ADD CONSTRAINT `RestaurantePedido_restauranteCaixaId_fkey`
    FOREIGN KEY (`restauranteCaixaId`) REFERENCES `RestauranteCaixaSessao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
