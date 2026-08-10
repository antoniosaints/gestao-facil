-- Itens avulsos vivem apenas no cardápio; itens vinculados continuam usando Produto para estoque.
ALTER TABLE `RestauranteCatalogoItem`
  ADD COLUMN `preco` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  MODIFY COLUMN `produtoId` INTEGER NULL;

UPDATE `RestauranteCatalogoItem` AS item
INNER JOIN `Produto` AS produto ON produto.`id` = item.`produtoId` AND produto.`contaId` = item.`contaId`
SET item.`preco` = produto.`preco`;

ALTER TABLE `RestaurantePedidoItem`
  MODIFY COLUMN `produtoId` INTEGER NULL;
