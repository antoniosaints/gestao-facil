-- CreateTable
CREATE TABLE `CobrancasOnAgendamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agendamentoId` INTEGER NOT NULL,
    `cobrancaId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CobrancasOnAgendamentos` ADD CONSTRAINT `CobrancasOnAgendamentos_agendamentoId_fkey` FOREIGN KEY (`agendamentoId`) REFERENCES `ArenaAgendamentos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CobrancasOnAgendamentos` ADD CONSTRAINT `CobrancasOnAgendamentos_cobrancaId_fkey` FOREIGN KEY (`cobrancaId`) REFERENCES `CobrancasFinanceiras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
