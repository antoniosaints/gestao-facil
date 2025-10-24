/*
  Warnings:

  - Added the required column `clienteId` to the `OrdensServico` table without a default value. This is not possible if the table is not empty.
  - Added the required column `operadorId` to the `OrdensServico` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `OrdensServico` ADD COLUMN `clienteId` INTEGER NOT NULL,
    ADD COLUMN `operadorId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `Produto` ADD COLUMN `categoria` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `OrdensServico` ADD CONSTRAINT `OrdensServico_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrdensServico` ADD CONSTRAINT `OrdensServico_operadorId_fkey` FOREIGN KEY (`operadorId`) REFERENCES `Usuarios`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
