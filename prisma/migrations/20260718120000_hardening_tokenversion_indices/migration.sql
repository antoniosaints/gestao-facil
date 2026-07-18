-- AlterTable
ALTER TABLE `Usuarios` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `ClientesFornecedores_contaId_status_idx` ON `ClientesFornecedores`(`contaId`, `status`);

-- CreateIndex
CREATE INDEX `Produto_contaId_status_idx` ON `Produto`(`contaId`, `status`);

-- CreateIndex
CREATE INDEX `Servicos_contaId_status_idx` ON `Servicos`(`contaId`, `status`);

-- CreateIndex
CREATE INDEX `Vendas_contaId_status_idx` ON `Vendas`(`contaId`, `status`);

-- CreateIndex
CREATE INDEX `Vendas_contaId_data_idx` ON `Vendas`(`contaId`, `data`);

-- CreateIndex
CREATE INDEX `LancamentoFinanceiro_contaId_status_dataLancamento_idx` ON `LancamentoFinanceiro`(`contaId`, `status`, `dataLancamento`);
