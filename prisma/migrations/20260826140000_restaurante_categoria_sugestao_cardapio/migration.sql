ALTER TABLE `RestauranteCatalogoItem`
    ADD COLUMN `categoriaSugestaoId` INTEGER NULL,
    ADD INDEX `restaurante_catalogo_sugestao_categoria_idx` (`categoriaSugestaoId`),
    ADD CONSTRAINT `RestauranteCatalogoItem_categoriaSugestaoId_fkey`
      FOREIGN KEY (`categoriaSugestaoId`) REFERENCES `ProdutoCategoria`(`id`)
      ON DELETE SET NULL ON UPDATE CASCADE;
