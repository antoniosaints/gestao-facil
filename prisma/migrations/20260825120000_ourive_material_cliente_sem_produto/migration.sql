-- Materiais fornecidos pelo cliente não pertencem ao estoque da empresa.
-- Por isso não exigem vínculo com um produto cadastrado.
ALTER TABLE `OuriveMaterial`
  MODIFY COLUMN `produtoId` INTEGER NULL;
