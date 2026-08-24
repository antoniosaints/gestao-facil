-- Esta migration também contém as colunas de materiais que, em instalações já existentes,
-- não estavam presentes na migration financeira anterior.
-- Nenhuma coluna ou saldo da tabela Produto é modificado.
ALTER TABLE `OuriveMaterial`
  ADD COLUMN `unidade` ENUM('QUANTIDADE', 'PESO') NOT NULL DEFAULT 'QUANTIDADE',
  ADD COLUMN `medidaPlanejada` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `medidaConsumida` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `medidaUtilizada` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `medidaSobra` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `medidaQuebra` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `medidaPerdaReal` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `perdaEstimada` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `necessitaCompra` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `medidaNecessariaCompra` DECIMAL(12, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN `observacao` TEXT NULL,
  ADD COLUMN `finalizadoEm` DATETIME(3) NULL;

UPDATE `OuriveMaterial`
SET `medidaPlanejada` = `quantidadePlanejada`,
    `medidaConsumida` = `quantidadeConsumida`,
    `medidaUtilizada` = `quantidadeConsumida`;

ALTER TABLE `MovimentacoesEstoque`
  ADD COLUMN `observacao` TEXT NULL;

CREATE TABLE `OuriveNecessidadeCompra` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `ordemOuriveId` INTEGER NOT NULL,
  `materialId` INTEGER NOT NULL,
  `produtoId` INTEGER NOT NULL,
  `unidade` ENUM('QUANTIDADE', 'PESO') NOT NULL,
  `quantidadeNecessaria` DECIMAL(12, 3) NOT NULL,
  `quantidadeComprada` DECIMAL(12, 3) NULL,
  `custoUnitarioReal` DECIMAL(10, 2) NULL,
  `fornecedorId` INTEGER NULL,
  `status` ENUM('PENDENTE', 'ATENDIDA', 'CANCELADA') NOT NULL DEFAULT 'PENDENTE',
  `atendidaEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OuriveNecessidadeCompra_materialId_key`(`materialId`),
  INDEX `OuriveNecessidadeCompra_contaId_ordemOuriveId_status_idx`(`contaId`, `ordemOuriveId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Corrige registros criados quando o peso da OS era convertido indevidamente para mg.
-- O estoque genérico de produtos continua intacto e passa a ser comparado em gramas.
UPDATE `OuriveMaterial` AS material
LEFT JOIN `Produto` AS produto ON produto.`id` = material.`produtoId`
SET
  material.`quantidadePlanejada` = ROUND(material.`medidaPlanejada`),
  material.`quantidadeConsumida` = ROUND(material.`medidaConsumida`),
  material.`quantidadeDevolvida` = ROUND(material.`medidaSobra` + material.`medidaQuebra`),
  material.`medidaNecessariaCompra` = CASE
    WHEN material.`fornecidoPeloCliente` THEN 0
    ELSE GREATEST(0, material.`medidaPlanejada` - COALESCE(produto.`estoque`, 0))
  END,
  material.`necessitaCompra` = CASE
    WHEN material.`fornecidoPeloCliente` THEN FALSE
    WHEN material.`medidaPlanejada` > COALESCE(produto.`estoque`, 0) THEN TRUE
    ELSE FALSE
  END
WHERE material.`unidade` = 'PESO';

DELETE necessidade
FROM `OuriveNecessidadeCompra` AS necessidade
INNER JOIN `OuriveMaterial` AS material ON material.`id` = necessidade.`materialId`
WHERE necessidade.`status` = 'PENDENTE'
  AND material.`necessitaCompra` = FALSE;

UPDATE `OuriveNecessidadeCompra` AS necessidade
INNER JOIN `OuriveMaterial` AS material ON material.`id` = necessidade.`materialId`
SET necessidade.`quantidadeNecessaria` = material.`medidaNecessariaCompra`
WHERE necessidade.`status` = 'PENDENTE';
