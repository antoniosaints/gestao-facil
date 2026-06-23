-- Remove orphan sale movements left by the previous SET NULL relation.
UPDATE `CaixaSessao` caixa
JOIN (
  SELECT `caixaId`, SUM(`valor`) AS `total`
  FROM `CaixaMovimento`
  WHERE `tipo` = 'VENDA'
    AND `metodoPagamento` = 'DINHEIRO'
    AND `vendaId` IS NULL
  GROUP BY `caixaId`
) movimentos ON movimentos.`caixaId` = caixa.`id`
SET
  caixa.`saldoEsperado` = caixa.`saldoEsperado` - movimentos.`total`,
  caixa.`diferenca` = CASE
    WHEN caixa.`saldoContado` IS NULL THEN caixa.`diferenca`
    ELSE caixa.`saldoContado` - (caixa.`saldoEsperado` - movimentos.`total`)
  END;

DELETE FROM `CaixaMovimento`
WHERE `tipo` = 'VENDA'
  AND `vendaId` IS NULL;

-- Change CaixaMovimento sale relation to remove linked cash movement when a sale is deleted.
ALTER TABLE `CaixaMovimento` DROP FOREIGN KEY `CaixaMovimento_vendaId_fkey`;

ALTER TABLE `CaixaMovimento`
  ADD CONSTRAINT `CaixaMovimento_vendaId_fkey`
  FOREIGN KEY (`vendaId`) REFERENCES `Vendas`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
