/*
  Warnings:

  - Added the required column `contaId` to the `Assinatura` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contaId` to the `NotaFiscal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `Assinatura` ADD COLUMN `contaId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `NotaFiscal` ADD COLUMN `contaId` INTEGER NOT NULL;

-- CreateTable
CREATE TABLE `ArenaQuadras` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `precoHora` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ArenaAgendamentos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quadraId` INTEGER NOT NULL,
    `clienteId` INTEGER NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDENTE', 'CONFIRMADA', 'FINALIZADA', 'CANCELADA', 'BLOQUEADO') NOT NULL DEFAULT 'PENDENTE',
    `valor` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `recorrente` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ArenaAgendamentos_quadraId_startAt_endAt_idx`(`quadraId`, `startAt`, `endAt`),
    UNIQUE INDEX `ArenaAgendamentos_quadraId_startAt_endAt_key`(`quadraId`, `startAt`, `endAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotaFiscal` ADD CONSTRAINT `NotaFiscal_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assinatura` ADD CONSTRAINT `Assinatura_contaId_fkey` FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArenaAgendamentos` ADD CONSTRAINT `ArenaAgendamentos_quadraId_fkey` FOREIGN KEY (`quadraId`) REFERENCES `ArenaQuadras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ArenaAgendamentos` ADD CONSTRAINT `ArenaAgendamentos_clienteId_fkey` FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
