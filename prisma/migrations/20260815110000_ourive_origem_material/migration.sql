-- Materiais do cliente são apenas registrados na OS: não compõem o preço e não baixam estoque.
ALTER TABLE `OuriveMaterial`
  ADD COLUMN `fornecidoPeloCliente` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `valorUnitario` DECIMAL(10, 2) NULL;

-- Mantém os orçamentos já cadastrados compatíveis, usando o custo que já havia sido salvo.
UPDATE `OuriveMaterial`
SET `valorUnitario` = COALESCE(`custoSnapshot`, 0);

ALTER TABLE `OuriveMaterial`
  MODIFY COLUMN `valorUnitario` DECIMAL(10, 2) NOT NULL DEFAULT 0;
