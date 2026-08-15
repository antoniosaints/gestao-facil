CREATE TABLE `RestauranteRegraImpressaoDestino` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `regraId` INTEGER NOT NULL,
  `estacaoId` INTEGER NOT NULL,
  `fallbackEstacaoId` INTEGER NULL,
  `papel` VARCHAR(20) NOT NULL DEFAULT '80mm',
  `vias` INTEGER NOT NULL DEFAULT 1,
  `imprimirPedidoCompleto` BOOLEAN NOT NULL DEFAULT false,
  `ordem` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rest_print_dest_rule_station_uq`(`regraId`, `estacaoId`),
  INDEX `rest_print_dest_account_idx`(`contaId`),
  INDEX `rest_print_dest_station_idx`(`estacaoId`),
  INDEX `rest_print_dest_fallback_idx`(`fallbackEstacaoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestauranteRegraImpressaoDestino`
  ADD CONSTRAINT `rest_print_dest_account_fk` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `rest_print_dest_rule_fk` FOREIGN KEY (`regraId`) REFERENCES `RestauranteRegraImpressao`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rest_print_dest_station_fk` FOREIGN KEY (`estacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `rest_print_dest_fallback_fk` FOREIGN KEY (`fallbackEstacaoId`) REFERENCES `RestauranteEstacaoImpressao`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
