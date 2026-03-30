CREATE TABLE `ProdutoCategoria` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'PCAT_000',
    `nome` VARCHAR(191) NOT NULL,
    `status` ENUM('ATIVO', 'INATIVO', 'BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProdutoCategoria_contaId_nome_key`(`contaId`, `nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProdutoBase` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `categoriaId` INTEGER NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'PB_000',
    `nome` VARCHAR(191) NOT NULL,
    `descricao` VARCHAR(191) NULL,
    `status` ENUM('ATIVO', 'INATIVO', 'BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    `ncm` VARCHAR(191) NULL,
    `cest` VARCHAR(191) NULL,
    `cfop` VARCHAR(191) NULL,
    `origem` INTEGER NULL,
    `aliquotaIcms` DECIMAL(5, 2) NULL,
    `aliquotaIpi` DECIMAL(5, 2) NULL,
    `aliquotaPis` DECIMAL(5, 2) NULL,
    `aliquotaCofins` DECIMAL(5, 2) NULL,
    `codigoProduto` VARCHAR(191) NULL,
    `issAliquota` DECIMAL(5, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProdutoBase_contaId_nome_idx`(`contaId`, `nome`),
    INDEX `ProdutoBase_categoriaId_idx`(`categoriaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Produto`
    ADD COLUMN `produtoBaseId` INTEGER NULL,
    ADD COLUMN `nomeVariante` VARCHAR(191) NOT NULL DEFAULT 'Padrão',
    ADD COLUMN `ehPadrao` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `Produto_produtoBaseId_idx` ON `Produto`(`produtoBaseId`);

INSERT INTO `ProdutoCategoria` (`contaId`, `Uid`, `nome`, `status`, `createdAt`, `updatedAt`)
SELECT DISTINCT
    `p`.`contaId`,
    'PCAT_000',
    TRIM(`p`.`categoria`),
    'ATIVO',
    NOW(3),
    NOW(3)
FROM `Produto` `p`
WHERE `p`.`categoria` IS NOT NULL
  AND TRIM(`p`.`categoria`) <> '';

INSERT INTO `ProdutoBase` (
    `contaId`,
    `categoriaId`,
    `Uid`,
    `nome`,
    `descricao`,
    `status`,
    `ncm`,
    `cest`,
    `cfop`,
    `origem`,
    `aliquotaIcms`,
    `aliquotaIpi`,
    `aliquotaPis`,
    `aliquotaCofins`,
    `codigoProduto`,
    `issAliquota`,
    `createdAt`,
    `updatedAt`
)
SELECT
    `p`.`contaId`,
    `pc`.`id`,
    CONCAT('PB_', LPAD(`p`.`id`, 6, '0')),
    `p`.`nome`,
    `p`.`descricao`,
    `p`.`status`,
    `p`.`ncm`,
    `p`.`cest`,
    `p`.`cfop`,
    `p`.`origem`,
    `p`.`aliquotaIcms`,
    `p`.`aliquotaIpi`,
    `p`.`aliquotaPis`,
    `p`.`aliquotaCofins`,
    `p`.`codigoProduto`,
    `p`.`issAliquota`,
    NOW(3),
    NOW(3)
FROM `Produto` `p`
LEFT JOIN `ProdutoCategoria` `pc`
    ON `pc`.`contaId` = `p`.`contaId`
   AND `pc`.`nome` = TRIM(`p`.`categoria`);

UPDATE `Produto` `p`
INNER JOIN `ProdutoBase` `pb`
    ON `pb`.`Uid` = CONCAT('PB_', LPAD(`p`.`id`, 6, '0'))
SET
    `p`.`produtoBaseId` = `pb`.`id`,
    `p`.`nomeVariante` = 'Padrão',
    `p`.`ehPadrao` = true;

ALTER TABLE `ProdutoCategoria`
    ADD CONSTRAINT `ProdutoCategoria_contaId_fkey`
    FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProdutoBase`
    ADD CONSTRAINT `ProdutoBase_contaId_fkey`
    FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `ProdutoBase_categoriaId_fkey`
    FOREIGN KEY (`categoriaId`) REFERENCES `ProdutoCategoria`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Produto`
    ADD CONSTRAINT `Produto_produtoBaseId_fkey`
    FOREIGN KEY (`produtoBaseId`) REFERENCES `ProdutoBase`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
