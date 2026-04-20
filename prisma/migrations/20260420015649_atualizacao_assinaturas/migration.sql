-- CreateTable
CREATE TABLE `PlanoAssinatura` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'PLA_000',
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `status` ENUM('ATIVO', 'INATIVO') NOT NULL DEFAULT 'ATIVO',
    `periodicidadePadrao` ENUM('SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO') NOT NULL DEFAULT 'MENSAL',
    `intervaloDiasPadrao` INTEGER NULL,
    `valorBase` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `modoValorPadrao` ENUM('MANUAL', 'DINAMICO') NOT NULL DEFAULT 'DINAMICO',
    `gatewayPadrao` VARCHAR(191) NULL,
    `tipoCobrancaPadrao` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PlanoAssinatura_contaId_nome_key`(`contaId`, `nome`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanoAssinaturaItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `planoId` INTEGER NOT NULL,
    `tipoItem` ENUM('SERVICO', 'PRODUTO') NOT NULL,
    `servicoId` INTEGER NULL,
    `produtoId` INTEGER NULL,
    `descricaoSnapshot` VARCHAR(191) NOT NULL,
    `quantidade` INTEGER NOT NULL DEFAULT 1,
    `valorUnitario` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `cobrar` BOOLEAN NOT NULL DEFAULT true,
    `comodato` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaCliente` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `Uid` VARCHAR(191) NOT NULL DEFAULT 'ASC_000',
    `clienteId` INTEGER NOT NULL,
    `planoId` INTEGER NULL,
    `nomeContrato` VARCHAR(191) NOT NULL,
    `status` ENUM('ATIVA', 'SUSPENSA', 'CANCELADA', 'ENCERRADA') NOT NULL DEFAULT 'ATIVA',
    `modoValor` ENUM('MANUAL', 'DINAMICO') NOT NULL DEFAULT 'DINAMICO',
    `valorManual` DECIMAL(10, 2) NULL,
    `periodicidade` ENUM('SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO') NOT NULL DEFAULT 'MENSAL',
    `intervaloDiasPersonalizado` INTEGER NULL,
    `inicio` DATETIME(3) NOT NULL,
    `fim` DATETIME(3) NULL,
    `recorrenciaIndefinida` BOOLEAN NOT NULL DEFAULT true,
    `proximaCobranca` DATETIME(3) NOT NULL,
    `cobrancaAutomatica` BOOLEAN NOT NULL DEFAULT false,
    `gateway` VARCHAR(191) NULL,
    `tipoCobranca` VARCHAR(191) NULL,
    `gerarLancamentoFinanceiro` BOOLEAN NOT NULL DEFAULT false,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaId` INTEGER NOT NULL,
    `tipoItem` ENUM('SERVICO', 'PRODUTO') NOT NULL,
    `servicoId` INTEGER NULL,
    `produtoId` INTEGER NULL,
    `descricaoSnapshot` VARCHAR(191) NOT NULL,
    `quantidade` INTEGER NOT NULL DEFAULT 1,
    `valorUnitario` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `cobrar` BOOLEAN NOT NULL DEFAULT true,
    `comodato` BOOLEAN NOT NULL DEFAULT false,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaComodato` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaItemId` INTEGER NOT NULL,
    `produtoId` INTEGER NOT NULL,
    `quantidade` INTEGER NOT NULL DEFAULT 1,
    `identificacao` VARCHAR(191) NULL,
    `status` ENUM('EM_USO', 'DEVOLVIDO', 'PERDIDO', 'AVARIADO') NOT NULL DEFAULT 'EM_USO',
    `dataEntrega` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dataPrevistaDevolucao` DATETIME(3) NULL,
    `dataDevolucao` DATETIME(3) NULL,
    `observacoes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaCiclo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaId` INTEGER NOT NULL,
    `referencia` VARCHAR(191) NOT NULL,
    `inicioPeriodo` DATETIME(3) NOT NULL,
    `fimPeriodo` DATETIME(3) NOT NULL,
    `valorCalculado` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `valorCobrado` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` ENUM('PENDENTE', 'COBRADO', 'PAGO', 'ATRASADO', 'CANCELADO', 'FALHA') NOT NULL DEFAULT 'PENDENTE',
    `cobrancaFinanceiraId` INTEGER NULL,
    `lancamentoFinanceiroId` INTEGER NULL,
    `gatewayUsado` VARCHAR(191) NULL,
    `tipoCobrancaUsado` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AssinaturaCiclo_assinaturaId_referencia_key`(`assinaturaId`, `referencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssinaturaHistorico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assinaturaId` INTEGER NOT NULL,
    `evento` VARCHAR(191) NOT NULL,
    `payloadJson` TEXT NULL,
    `usuarioId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlanoAssinatura` ADD CONSTRAINT `PlanoAssinatura_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanoAssinaturaItem` ADD CONSTRAINT `PlanoAssinaturaItem_planoId_fkey` FOREIGN KEY (`planoId`) REFERENCES `PlanoAssinatura`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanoAssinaturaItem` ADD CONSTRAINT `PlanoAssinaturaItem_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanoAssinaturaItem` ADD CONSTRAINT `PlanoAssinaturaItem_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCliente` ADD CONSTRAINT `AssinaturaCliente_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCliente` ADD CONSTRAINT `AssinaturaCliente_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCliente` ADD CONSTRAINT `AssinaturaCliente_planoId_fkey` FOREIGN KEY (`planoId`) REFERENCES `PlanoAssinatura`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaItem` ADD CONSTRAINT `AssinaturaItem_assinaturaId_fkey` FOREIGN KEY (`assinaturaId`) REFERENCES `AssinaturaCliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaItem` ADD CONSTRAINT `AssinaturaItem_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaItem` ADD CONSTRAINT `AssinaturaItem_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaComodato` ADD CONSTRAINT `AssinaturaComodato_assinaturaItemId_fkey` FOREIGN KEY (`assinaturaItemId`) REFERENCES `AssinaturaItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaComodato` ADD CONSTRAINT `AssinaturaComodato_produtoId_fkey` FOREIGN KEY (`produtoId`) REFERENCES `Produto`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCiclo` ADD CONSTRAINT `AssinaturaCiclo_assinaturaId_fkey` FOREIGN KEY (`assinaturaId`) REFERENCES `AssinaturaCliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCiclo` ADD CONSTRAINT `AssinaturaCiclo_cobrancaFinanceiraId_fkey` FOREIGN KEY (`cobrancaFinanceiraId`) REFERENCES `CobrancasFinanceiras`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaCiclo` ADD CONSTRAINT `AssinaturaCiclo_lancamentoFinanceiroId_fkey` FOREIGN KEY (`lancamentoFinanceiroId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaHistorico` ADD CONSTRAINT `AssinaturaHistorico_assinaturaId_fkey` FOREIGN KEY (`assinaturaId`) REFERENCES `AssinaturaCliente`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssinaturaHistorico` ADD CONSTRAINT `AssinaturaHistorico_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
