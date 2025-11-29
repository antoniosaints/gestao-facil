-- CreateTable
CREATE TABLE `ArenaAgendamentosPagamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agendamentoId` INTEGER NOT NULL,
    `valor` DECIMAL(65, 30) NOT NULL,
    `tipo` ENUM('TOTAL', 'PARCIAL') NOT NULL DEFAULT 'TOTAL',
    `metodoPagamento` ENUM('PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO') NOT NULL DEFAULT 'PIX',
    `dataPagamento` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ArenaAgendamentosPagamentos` ADD CONSTRAINT `ArenaAgendamentosPagamentos_agendamentoId_fkey` FOREIGN KEY (`agendamentoId`) REFERENCES `ArenaAgendamentos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
