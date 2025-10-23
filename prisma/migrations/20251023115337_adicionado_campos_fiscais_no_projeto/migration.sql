-- AlterTable
ALTER TABLE `ClientesFornecedores` ADD COLUMN `bairro` VARCHAR(191) NULL,
    ADD COLUMN `ie` VARCHAR(191) NULL,
    ADD COLUMN `im` VARCHAR(191) NULL,
    ADD COLUMN `municipio` VARCHAR(191) NULL,
    ADD COLUMN `numero` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `ambiente` VARCHAR(191) NOT NULL DEFAULT 'homologacao',
    ADD COLUMN `certificadoPath` VARCHAR(191) NULL,
    ADD COLUMN `chaveAcesso` VARCHAR(191) NULL,
    ADD COLUMN `ie` VARCHAR(191) NULL,
    ADD COLUMN `im` VARCHAR(191) NULL,
    ADD COLUMN `regimeTributario` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `regimeTributarioEspecial` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Produto` ADD COLUMN `aliquotaCofins` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaIcms` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaIpi` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaPis` DECIMAL(5, 2) NULL,
    ADD COLUMN `cest` VARCHAR(191) NULL,
    ADD COLUMN `cfop` VARCHAR(191) NULL,
    ADD COLUMN `codigoProduto` VARCHAR(191) NULL,
    ADD COLUMN `issAliquota` DECIMAL(5, 2) NULL,
    ADD COLUMN `ncm` VARCHAR(191) NULL,
    ADD COLUMN `origem` INTEGER NULL;

-- AlterTable
ALTER TABLE `Servicos` ADD COLUMN `aliquotaCofins` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaIcms` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaIpi` DECIMAL(5, 2) NULL,
    ADD COLUMN `aliquotaPis` DECIMAL(5, 2) NULL,
    ADD COLUMN `cest` VARCHAR(191) NULL,
    ADD COLUMN `cfop` VARCHAR(191) NULL,
    ADD COLUMN `codigoProduto` VARCHAR(191) NULL,
    ADD COLUMN `issAliquota` DECIMAL(5, 2) NULL,
    ADD COLUMN `ncm` VARCHAR(191) NULL,
    ADD COLUMN `origem` INTEGER NULL;

-- CreateTable
CREATE TABLE `NotaFiscal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo` VARCHAR(191) NOT NULL,
    `clienteId` INTEGER NOT NULL,
    `valorTotal` DECIMAL(10, 2) NOT NULL,
    `chaveAcesso` VARCHAR(191) NULL,
    `protocolo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `xmlPath` VARCHAR(191) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotaFiscal` ADD CONSTRAINT `NotaFiscal_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
