/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Usuarios` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `CategoriaFinanceiro` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'CAT_000';

-- AlterTable
ALTER TABLE `ClientesFornecedores` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'CLI_000';

-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `dicasNovidades` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `documento` VARCHAR(191) NULL,
    ADD COLUMN `funcionarios` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `telefone` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `ContasFinanceiro` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'CON_000';

-- AlterTable
ALTER TABLE `FaturasContas` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'INV_000';

-- AlterTable
ALTER TABLE `LancamentoFinanceiro` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'FIN_000',
    ADD COLUMN `valorBruto` DECIMAL(65, 30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `MovimentacoesEstoque` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'MOV_000';

-- AlterTable
ALTER TABLE `Parcela` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'PAR_000';

-- AlterTable
ALTER TABLE `Produto` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'PRO_000';

-- AlterTable
ALTER TABLE `Usuarios` MODIFY `permissao` ENUM('root', 'admin', 'gerente', 'vendedor', 'tecnico', 'usuario') NOT NULL DEFAULT 'usuario';

-- AlterTable
ALTER TABLE `Vendas` ADD COLUMN `Uid` VARCHAR(191) NOT NULL DEFAULT 'VEN_000';

-- CreateIndex
CREATE UNIQUE INDEX `Usuarios_email_key` ON `Usuarios`(`email`);
