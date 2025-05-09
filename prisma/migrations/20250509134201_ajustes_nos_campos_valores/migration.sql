-- AlterTable
ALTER TABLE `Contas` MODIFY `valor` DECIMAL(10, 2) NOT NULL;

-- AlterTable
ALTER TABLE `ItensVendas` MODIFY `valor` DECIMAL(10, 2) NOT NULL;

-- AlterTable
ALTER TABLE `Produto` MODIFY `preco` DECIMAL(10, 2) NOT NULL,
    MODIFY `precoCompra` DECIMAL(10, 2) NULL;

-- AlterTable
ALTER TABLE `Vendas` MODIFY `valor` DECIMAL(10, 2) NOT NULL;
