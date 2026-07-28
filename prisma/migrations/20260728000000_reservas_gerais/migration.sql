-- AlterTable
ALTER TABLE `CobrancasFinanceiras` ADD COLUMN `reservaGeralId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LancamentoFinanceiro` ADD COLUMN `reservaGeralId` INTEGER NULL,
    ADD COLUMN `reservaPagamentoEstornoId` INTEGER NULL,
    MODIFY `origemSistema` ENUM('MANUAL', 'ASSINATURA_PAGAR', 'RESERVA') NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE `ReservaConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `slug` VARCHAR(80) NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT false,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/Sao_Paulo',
    `antecedenciaMinimaMinutos` INTEGER NOT NULL DEFAULT 60,
    `horizonteDias` INTEGER NOT NULL DEFAULT 90,
    `expiracaoPagamentoMinutos` INTEGER NOT NULL DEFAULT 15,
    `antecedenciaRemarcacaoHoras` INTEGER NOT NULL DEFAULT 24,
    `antecedenciaCancelamentoHoras` INTEGER NOT NULL DEFAULT 24,
    `titulo` VARCHAR(191) NULL,
    `descricao` TEXT NULL,
    `bannerUrl` TEXT NULL,
    `corPrimaria` VARCHAR(191) NOT NULL DEFAULT '#0f766e',
    `corSecundaria` VARCHAR(191) NOT NULL DEFAULT '#f59e0b',
    `termos` TEXT NULL,
    `termosVersao` INTEGER NOT NULL DEFAULT 1,
    `themeConfig` JSON NULL,
    `secoes` JSON NULL,
    `lancamentoAutomatico` BOOLEAN NOT NULL DEFAULT false,
    `categoriaFinanceiraId` INTEGER NULL,
    `contaFinanceiraId` INTEGER NULL,
    `whatsappPendenteAtivo` BOOLEAN NOT NULL DEFAULT false,
    `whatsappPendenteTemplate` TEXT NULL,
    `whatsappConfirmadaAtivo` BOOLEAN NOT NULL DEFAULT false,
    `whatsappConfirmadaTemplate` TEXT NULL,
    `whatsappLembreteAtivo` BOOLEAN NOT NULL DEFAULT false,
    `whatsappLembreteHoras` INTEGER NOT NULL DEFAULT 24,
    `whatsappLembreteTemplate` TEXT NULL,
    `whatsappPosVendaAtivo` BOOLEAN NOT NULL DEFAULT false,
    `whatsappPosVendaHoras` INTEGER NOT NULL DEFAULT 2,
    `whatsappPosVendaTemplate` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReservaConfig_contaId_key`(`contaId`),
    UNIQUE INDEX `ReservaConfig_slug_key`(`slug`),
    INDEX `ReservaConfig_contaId_ativo_idx`(`contaId`, `ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaRecurso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `nome` VARCHAR(191) NOT NULL,
    `descricao` TEXT NULL,
    `tipo` ENUM('PROFISSIONAL', 'SALA', 'EQUIPAMENTO') NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `publico` BOOLEAN NOT NULL DEFAULT true,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReservaRecurso_contaId_ativo_publico_idx`(`contaId`, `ativo`, `publico`),
    UNIQUE INDEX `ReservaRecurso_id_contaId_key`(`id`, `contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaServicoConfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `servicoId` INTEGER NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `publico` BOOLEAN NOT NULL DEFAULT true,
    `duracaoMinutos` INTEGER NOT NULL DEFAULT 60,
    `intervaloAntesMinutos` INTEGER NOT NULL DEFAULT 0,
    `intervaloDepoisMinutos` INTEGER NOT NULL DEFAULT 0,
    `politicaPagamento` ENUM('NENHUM', 'INTEGRAL', 'SINAL_FIXO', 'SINAL_PERCENTUAL') NOT NULL DEFAULT 'NENHUM',
    `valorSinal` DECIMAL(10, 2) NULL,
    `percentualSinal` DECIMAL(5, 2) NULL,
    `permitirQualquerRecurso` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReservaServicoConfig_servicoId_key`(`servicoId`),
    INDEX `ReservaServicoConfig_contaId_ativo_publico_idx`(`contaId`, `ativo`, `publico`),
    UNIQUE INDEX `ReservaServicoConfig_id_contaId_key`(`id`, `contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaServicoRecurso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `servicoConfigId` INTEGER NOT NULL,
    `recursoId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReservaServicoRecurso_contaId_recursoId_idx`(`contaId`, `recursoId`),
    UNIQUE INDEX `ReservaServicoRecurso_contaId_servicoConfigId_recursoId_key`(`contaId`, `servicoConfigId`, `recursoId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaDisponibilidade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `recursoId` INTEGER NOT NULL,
    `diaSemana` INTEGER NOT NULL,
    `inicioMinuto` INTEGER NOT NULL,
    `fimMinuto` INTEGER NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReservaDisponibilidade_contaId_recursoId_diaSemana_ativo_idx`(`contaId`, `recursoId`, `diaSemana`, `ativo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaExcecaoAgenda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `recursoId` INTEGER NOT NULL,
    `inicio` DATETIME(3) NOT NULL,
    `fim` DATETIME(3) NOT NULL,
    `tipo` ENUM('DISPONIVEL', 'BLOQUEADO') NOT NULL,
    `motivo` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReservaExcecaoAgenda_contaId_recursoId_inicio_fim_idx`(`contaId`, `recursoId`, `inicio`, `fim`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaGeral` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `publicId` VARCHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(80) NULL,
    `tokenGestaoHash` VARCHAR(64) NOT NULL,
    `servicoConfigId` INTEGER NOT NULL,
    `recursoId` INTEGER NOT NULL,
    `clienteId` INTEGER NULL,
    `nomeCliente` VARCHAR(191) NOT NULL,
    `telefoneCliente` VARCHAR(191) NOT NULL,
    `emailCliente` VARCHAR(191) NULL,
    `servicoNome` VARCHAR(191) NOT NULL,
    `recursoNome` VARCHAR(191) NOT NULL,
    `inicio` DATETIME(3) NOT NULL,
    `fim` DATETIME(3) NOT NULL,
    `valorTotal` DECIMAL(10, 2) NOT NULL,
    `valorPagamento` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `valorPago` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `politicaPagamento` ENUM('NENHUM', 'INTEGRAL', 'SINAL_FIXO', 'SINAL_PERCENTUAL') NOT NULL,
    `status` ENUM('AGUARDANDO_PAGAMENTO', 'CONFIRMADA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA') NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    `expiraEm` DATETIME(3) NULL,
    `confirmadaEm` DATETIME(3) NULL,
    `concluidaEm` DATETIME(3) NULL,
    `canceladaEm` DATETIME(3) NULL,
    `motivoCancelamento` TEXT NULL,
    `faturadaEm` DATETIME(3) NULL,
    `termosVersao` INTEGER NOT NULL,
    `aceitouTermos` BOOLEAN NOT NULL DEFAULT false,
    `consentiuAvisos` BOOLEAN NOT NULL DEFAULT false,
    `consentiuPosVenda` BOOLEAN NOT NULL DEFAULT false,
    `observacoes` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReservaGeral_publicId_key`(`publicId`),
    INDEX `ReservaGeral_contaId_status_inicio_idx`(`contaId`, `status`, `inicio`),
    INDEX `ReservaGeral_contaId_recursoId_inicio_fim_idx`(`contaId`, `recursoId`, `inicio`, `fim`),
    INDEX `ReservaGeral_contaId_clienteId_inicio_idx`(`contaId`, `clienteId`, `inicio`),
    UNIQUE INDEX `ReservaGeral_contaId_idempotencyKey_key`(`contaId`, `idempotencyKey`),
    UNIQUE INDEX `ReservaGeral_id_contaId_key`(`id`, `contaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaHistorico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `reservaId` INTEGER NOT NULL,
    `evento` VARCHAR(80) NOT NULL,
    `usuarioId` INTEGER NULL,
    `dados` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReservaHistorico_contaId_reservaId_createdAt_idx`(`contaId`, `reservaId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaPagamento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `reservaId` INTEGER NOT NULL,
    `cobrancaId` INTEGER NULL,
    `gateway` ENUM('MERCADOPAGO', 'MANUAL') NOT NULL,
    `gatewayReferencia` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(80) NOT NULL,
    `valor` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDENTE', 'APROVADO', 'RECUSADO', 'CANCELADO', 'ESTORNADO') NOT NULL DEFAULT 'PENDENTE',
    `linkPagamento` TEXT NULL,
    `pixCopiaCola` TEXT NULL,
    `aprovadoEm` DATETIME(3) NULL,
    `estornadoEm` DATETIME(3) NULL,
    `erro` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReservaPagamento_cobrancaId_key`(`cobrancaId`),
    INDEX `ReservaPagamento_contaId_reservaId_status_idx`(`contaId`, `reservaId`, `status`),
    UNIQUE INDEX `ReservaPagamento_contaId_idempotencyKey_key`(`contaId`, `idempotencyKey`),
    UNIQUE INDEX `ReservaPagamento_contaId_gateway_gatewayReferencia_key`(`contaId`, `gateway`, `gatewayReferencia`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaNotificacao` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `reservaId` INTEGER NOT NULL,
    `evento` ENUM('PENDENTE_PAGAMENTO', 'CONFIRMADA', 'HORARIO_PROXIMO', 'POS_VENDA') NOT NULL,
    `status` ENUM('AGENDADA', 'PROCESSANDO', 'ENVIADA', 'FALHOU', 'CANCELADA') NOT NULL DEFAULT 'AGENDADA',
    `agendadaPara` DATETIME(3) NOT NULL,
    `template` TEXT NOT NULL,
    `mensagem` TEXT NOT NULL,
    `tentativas` INTEGER NOT NULL DEFAULT 0,
    `ultimaTentativaEm` DATETIME(3) NULL,
    `enviadaEm` DATETIME(3) NULL,
    `erro` TEXT NULL,
    `versaoReserva` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReservaNotificacao_contaId_status_agendadaPara_idx`(`contaId`, `status`, `agendadaPara`),
    UNIQUE INDEX `ReservaNotificacao_reservaId_evento_agendadaPara_versaoReser_key`(`reservaId`, `evento`, `agendadaPara`, `versaoReserva`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReservaAgendaLock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contaId` INTEGER NOT NULL,
    `recursoId` INTEGER NOT NULL,
    `dataLocal` DATE NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReservaAgendaLock_contaId_recursoId_dataLocal_key`(`contaId`, `recursoId`, `dataLocal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `CobrancasFinanceiras_contaId_reservaGeralId_idx` ON `CobrancasFinanceiras`(`contaId`, `reservaGeralId`);

-- CreateIndex
CREATE UNIQUE INDEX `LancamentoFinanceiro_reservaGeralId_key` ON `LancamentoFinanceiro`(`reservaGeralId`);

-- CreateIndex
CREATE UNIQUE INDEX `LancamentoFinanceiro_reservaPagamentoEstornoId_key` ON `LancamentoFinanceiro`(`reservaPagamentoEstornoId`);

-- AddForeignKey
ALTER TABLE `CobrancasFinanceiras` ADD CONSTRAINT `CobrancasFinanceiras_reservaGeralId_fkey` FOREIGN KEY (`reservaGeralId`) REFERENCES `ReservaGeral`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_reservaGeralId_fkey` FOREIGN KEY (`reservaGeralId`) REFERENCES `ReservaGeral`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoFinanceiro` ADD CONSTRAINT `LancamentoFinanceiro_reservaPagamentoEstornoId_fkey` FOREIGN KEY (`reservaPagamentoEstornoId`) REFERENCES `ReservaPagamento`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaConfig` ADD CONSTRAINT `ReservaConfig_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaRecurso` ADD CONSTRAINT `ReservaRecurso_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaServicoConfig` ADD CONSTRAINT `ReservaServicoConfig_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaServicoConfig` ADD CONSTRAINT `ReservaServicoConfig_servicoId_fkey` FOREIGN KEY (`servicoId`) REFERENCES `Servicos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaServicoRecurso` ADD CONSTRAINT `ReservaServicoRecurso_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaServicoRecurso` ADD CONSTRAINT `ReservaServicoRecurso_servicoConfigId_fkey` FOREIGN KEY (`servicoConfigId`) REFERENCES `ReservaServicoConfig`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaServicoRecurso` ADD CONSTRAINT `ReservaServicoRecurso_recursoId_fkey` FOREIGN KEY (`recursoId`) REFERENCES `ReservaRecurso`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaDisponibilidade` ADD CONSTRAINT `ReservaDisponibilidade_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaDisponibilidade` ADD CONSTRAINT `ReservaDisponibilidade_recursoId_fkey` FOREIGN KEY (`recursoId`) REFERENCES `ReservaRecurso`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaExcecaoAgenda` ADD CONSTRAINT `ReservaExcecaoAgenda_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaExcecaoAgenda` ADD CONSTRAINT `ReservaExcecaoAgenda_recursoId_fkey` FOREIGN KEY (`recursoId`) REFERENCES `ReservaRecurso`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaGeral` ADD CONSTRAINT `ReservaGeral_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaGeral` ADD CONSTRAINT `ReservaGeral_servicoConfigId_fkey` FOREIGN KEY (`servicoConfigId`) REFERENCES `ReservaServicoConfig`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaGeral` ADD CONSTRAINT `ReservaGeral_recursoId_fkey` FOREIGN KEY (`recursoId`) REFERENCES `ReservaRecurso`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaGeral` ADD CONSTRAINT `ReservaGeral_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaHistorico` ADD CONSTRAINT `ReservaHistorico_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaHistorico` ADD CONSTRAINT `ReservaHistorico_reservaId_fkey` FOREIGN KEY (`reservaId`) REFERENCES `ReservaGeral`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaPagamento` ADD CONSTRAINT `ReservaPagamento_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaPagamento` ADD CONSTRAINT `ReservaPagamento_reservaId_fkey` FOREIGN KEY (`reservaId`) REFERENCES `ReservaGeral`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaPagamento` ADD CONSTRAINT `ReservaPagamento_cobrancaId_fkey` FOREIGN KEY (`cobrancaId`) REFERENCES `CobrancasFinanceiras`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaNotificacao` ADD CONSTRAINT `ReservaNotificacao_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaNotificacao` ADD CONSTRAINT `ReservaNotificacao_reservaId_fkey` FOREIGN KEY (`reservaId`) REFERENCES `ReservaGeral`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaAgendaLock` ADD CONSTRAINT `ReservaAgendaLock_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReservaAgendaLock` ADD CONSTRAINT `ReservaAgendaLock_recursoId_fkey` FOREIGN KEY (`recursoId`) REFERENCES `ReservaRecurso`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
