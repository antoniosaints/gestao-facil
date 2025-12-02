-- DropForeignKey
ALTER TABLE `CobrancasOnAgendamentos` DROP FOREIGN KEY `CobrancasOnAgendamentos_agendamentoId_fkey`;

-- DropForeignKey
ALTER TABLE `CobrancasOnAgendamentos` DROP FOREIGN KEY `CobrancasOnAgendamentos_cobrancaId_fkey`;

-- DropIndex
DROP INDEX `CobrancasOnAgendamentos_agendamentoId_fkey` ON `CobrancasOnAgendamentos`;

-- DropIndex
DROP INDEX `CobrancasOnAgendamentos_cobrancaId_fkey` ON `CobrancasOnAgendamentos`;

-- AddForeignKey
ALTER TABLE `CobrancasOnAgendamentos` ADD CONSTRAINT `CobrancasOnAgendamentos_agendamentoId_fkey` FOREIGN KEY (`agendamentoId`) REFERENCES `ArenaAgendamentos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CobrancasOnAgendamentos` ADD CONSTRAINT `CobrancasOnAgendamentos_cobrancaId_fkey` FOREIGN KEY (`cobrancaId`) REFERENCES `CobrancasFinanceiras`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
