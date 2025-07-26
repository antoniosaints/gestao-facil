-- AlterTable
ALTER TABLE `Contas` ADD COLUMN `gateway` ENUM('mercadopago', 'asaass') NOT NULL DEFAULT 'mercadopago';

-- AlterTable
ALTER TABLE `Usuarios` ADD COLUMN `permissao` ENUM('admin', 'gerente', 'vendedor', 'tecnico', 'usuario') NOT NULL DEFAULT 'usuario';

-- CreateTable
CREATE TABLE `ContasFinanceiro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `saldoInicial` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CategoriaFinanceiro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LancamentoFinanceiro` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `descricao` VARCHAR(191) NOT NULL,
    `valorTotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `valorEntrada` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `desconto` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `tipo` ENUM('RECEITA', 'DESPESA') NOT NULL,
    `formaPagamento` ENUM('DINHEIRO', 'CREDITO', 'DEBITO', 'PIX', 'BOLETO', 'TRANSFERENCIA') NOT NULL,
    `status` ENUM('PENDENTE', 'PAGO', 'ATRASADO', 'PARCIAL') NOT NULL,
    `recorrente` BOOLEAN NOT NULL DEFAULT false,
    `dataLancamento` DATETIME(3) NOT NULL,
    `clienteId` INTEGER NULL,
    `categoriaId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `contasFinanceiroId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Parcela` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `numero` INTEGER NOT NULL,
    `valor` DECIMAL(65, 30) NOT NULL,
    `vencimento` DATETIME(3) NOT NULL,
    `pago` BOOLEAN NOT NULL DEFAULT false,
    `dataPagamento` DATETIME(3) NULL,
    `lancamentoId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ContasFinanceiro` ADD CONSTRAINT `ContasFinanceiro_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CategoriaFinanceiro` ADD CONSTRAINT `CategoriaFinanceiro_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_categoriaId_fkey` FOREIGN KEY (`categoriaId`) REFERENCES `CategoriaFinanceiro`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_contasFinanceiroId_fkey` FOREIGN KEY (`contasFinanceiroId`) REFERENCES `ContasFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Parcela` ADD CONSTRAINT `Parcela_lancamentoId_fkey` FOREIGN KEY (`lancamentoId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
