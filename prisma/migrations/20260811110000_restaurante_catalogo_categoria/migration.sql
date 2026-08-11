-- A categoria do item avulso fica no próprio cardápio; para itens vinculados,
-- ela é copiada da categoria do produto base e mantida pelo backend.
-- A guarda permite retomar com segurança se uma execução anterior parou após o ALTER TABLE.
SET @categoria_coluna_existe := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'RestauranteCatalogoItem'
    AND COLUMN_NAME = 'categoriaId'
);
SET @categoria_sql := IF(
  @categoria_coluna_existe = 0,
  'ALTER TABLE `RestauranteCatalogoItem` ADD COLUMN `categoriaId` INTEGER NULL',
  'SELECT 1'
);
PREPARE categoria_stmt FROM @categoria_sql;
EXECUTE categoria_stmt;
DEALLOCATE PREPARE categoria_stmt;

-- Itens avulsos e produtos legados sem categoria recebem uma categoria visível
-- de migração, evitando registros de cardápio sem vínculo categórico.
INSERT INTO `ProdutoCategoria` (`contaId`, `Uid`, `nome`, `status`, `createdAt`, `updatedAt`)
SELECT DISTINCT item.`contaId`, CONCAT('PCAT_MIG_', item.`contaId`), 'Itens do cardápio', 'ATIVO', NOW(3), NOW(3)
FROM `RestauranteCatalogoItem` AS item
LEFT JOIN `ProdutoCategoria` AS categoria
  ON categoria.`contaId` = item.`contaId` AND categoria.`nome` = 'Itens do cardápio'
WHERE categoria.`id` IS NULL;

UPDATE `ProdutoBase` AS produtoBase
INNER JOIN `Produto` AS produto ON produto.`produtoBaseId` = produtoBase.`id`
INNER JOIN `RestauranteCatalogoItem` AS item ON item.`produtoId` = produto.`id` AND item.`contaId` = produto.`contaId`
INNER JOIN `ProdutoCategoria` AS categoria
  ON categoria.`contaId` = item.`contaId` AND categoria.`nome` = 'Itens do cardápio'
SET produtoBase.`categoriaId` = categoria.`id`
WHERE produtoBase.`categoriaId` IS NULL;

UPDATE `RestauranteCatalogoItem` AS item
INNER JOIN `Produto` AS produto ON produto.`id` = item.`produtoId` AND produto.`contaId` = item.`contaId`
INNER JOIN `ProdutoBase` AS produtoBase ON produtoBase.`id` = produto.`produtoBaseId` AND produtoBase.`contaId` = item.`contaId`
SET item.`categoriaId` = produtoBase.`categoriaId`
WHERE produtoBase.`categoriaId` IS NOT NULL;

UPDATE `RestauranteCatalogoItem` AS item
INNER JOIN `ProdutoCategoria` AS categoria
  ON categoria.`contaId` = item.`contaId` AND categoria.`nome` = 'Itens do cardápio'
SET item.`categoriaId` = categoria.`id`
WHERE item.`categoriaId` IS NULL;

ALTER TABLE `RestauranteCatalogoItem`
  MODIFY COLUMN `categoriaId` INTEGER NOT NULL;

SET @categoria_indice_existe := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'RestauranteCatalogoItem'
    AND INDEX_NAME = 'RestauranteCatalogoItem_contaId_categoriaId_idx'
);
SET @categoria_sql := IF(
  @categoria_indice_existe = 0,
  'CREATE INDEX `RestauranteCatalogoItem_contaId_categoriaId_idx` ON `RestauranteCatalogoItem`(`contaId`, `categoriaId`)',
  'SELECT 1'
);
PREPARE categoria_stmt FROM @categoria_sql;
EXECUTE categoria_stmt;
DEALLOCATE PREPARE categoria_stmt;

SET @categoria_fk_existe := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'RestauranteCatalogoItem'
    AND CONSTRAINT_NAME = 'RestauranteCatalogoItem_categoriaId_fkey'
);
SET @categoria_sql := IF(
  @categoria_fk_existe = 0,
  'ALTER TABLE `RestauranteCatalogoItem` ADD CONSTRAINT `RestauranteCatalogoItem_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `ProdutoCategoria`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE categoria_stmt FROM @categoria_sql;
EXECUTE categoria_stmt;
DEALLOCATE PREPARE categoria_stmt;
