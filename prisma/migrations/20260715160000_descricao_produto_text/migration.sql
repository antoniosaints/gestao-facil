-- Descrição de produto/variante era VARCHAR(191) (padrão do MySQL para String), o que cortava
-- qualquer descrição um pouco mais longa. TEXT comporta ~65KB.
-- Alargamento de tipo: nenhum dado existente é truncado ou perdido.
-- Nenhuma das colunas participa de índice ou unique, então a conversão é direta.

-- AlterTable
ALTER TABLE `Produto` MODIFY `descricao` TEXT NULL;

-- AlterTable
ALTER TABLE `ProdutoBase` MODIFY `descricao` TEXT NULL;
