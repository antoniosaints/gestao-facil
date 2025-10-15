-- CreateTable
CREATE TABLE `MensagensInteracoesOrdemServico` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ordemId` INTEGER NOT NULL,
    `mensagem` VARCHAR(191) NOT NULL,
    `tipo` ENUM('ABERTURA', 'MENSAGEM', 'ENCERRAMENTO') NOT NULL DEFAULT 'ABERTURA',
    `autorId` INTEGER NULL,
    `data` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MensagensInteracoesOrdemServico` ADD CONSTRAINT `MensagensInteracoesOrdemServico_ordemId_fkey` FOREIGN KEY (`ordemId`) REFERENCES `OrdensServico`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MensagensInteracoesOrdemServico` ADD CONSTRAINT `MensagensInteracoesOrdemServico_autorId_fkey` FOREIGN KEY (`autorId`) REFERENCES `Usuarios`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
