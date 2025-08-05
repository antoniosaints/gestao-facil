-- AlterTable
ALTER TABLE `ClientesFornecedores` ADD COLUMN `cep` VARCHAR(191) NULL,
    ADD COLUMN `cidade` VARCHAR(191) NULL,
    ADD COLUMN `documento` VARCHAR(191) NULL,
    ADD COLUMN `endereco` VARCHAR(191) NULL,
    ADD COLUMN `estado` VARCHAR(191) NULL,
    ADD COLUMN `observacaos` VARCHAR(191) NULL,
    ADD COLUMN `whastapp` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `profile` VARCHAR(191) NULL DEFAULT 'imgs/logo.png';

-- AlterTable
ALTER TABLE `Vendas` ADD COLUMN `desconto` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `observacoes` TEXT NULL;
