-- AlterTable: conta financeira/categoria opcionais por contrato (AssinaturaCliente)
ALTER TABLE `AssinaturaCliente`
  ADD COLUMN `contaFinanceiraId` INTEGER NULL,
  ADD COLUMN `categoriaId` INTEGER NULL;

-- AlterTable: modo de cobranca por item (mensalidade / unica / parcelada)
ALTER TABLE `AssinaturaItem`
  ADD COLUMN `modoCobranca` ENUM('MENSALIDADE', 'UNICA', 'PARCELADA') NOT NULL DEFAULT 'MENSALIDADE',
  ADD COLUMN `cobrarVezes` INTEGER NULL,
  ADD COLUMN `vezesCobradas` INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE `AssinaturaCliente` ADD CONSTRAINT `AssinaturaCliente_contaFinanceiraId_fkey` FOREIGN KEY (`contaFinanceiraId`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCliente` ADD CONSTRAINT `AssinaturaCliente_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
