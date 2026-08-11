-- A sequência é própria de cada restaurante e começa após seus pedidos já existentes.
SET @numero_pedido_coluna_existe := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'RestauranteConfig'
    AND COLUMN_NAME = 'proximoNumeroPedido'
);
SET @numero_pedido_sql := IF(
  @numero_pedido_coluna_existe = 0,
  'ALTER TABLE `RestauranteConfig` ADD COLUMN `proximoNumeroPedido` INTEGER NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE numero_pedido_stmt FROM @numero_pedido_sql;
EXECUTE numero_pedido_stmt;
DEALLOCATE PREPARE numero_pedido_stmt;

UPDATE `RestauranteConfig` AS config
LEFT JOIN (
  SELECT `contaId`, COUNT(*) + 1 AS `proximoNumeroPedido`
  FROM `RestaurantePedido`
  GROUP BY `contaId`
) AS pedidos ON pedidos.`contaId` = config.`contaId`
SET config.`proximoNumeroPedido` = COALESCE(pedidos.`proximoNumeroPedido`, 1);
