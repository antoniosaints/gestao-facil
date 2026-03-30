ALTER TABLE `ModuloOnConta`
    ADD COLUMN `tipoCobrancaAtual` ENUM('PROPORCIONAL', 'MENSAL') NULL,
    ADD COLUMN `valorCobrancaAtual` DECIMAL(10, 2) NULL,
    ADD COLUMN `cobrancaAtualId` INTEGER NULL,
    ADD UNIQUE INDEX `ModuloOnConta_cobrancaAtualId_key`(`cobrancaAtualId`),
    ADD CONSTRAINT `ModuloOnConta_cobrancaAtualId_fkey`
        FOREIGN KEY (`cobrancaAtualId`) REFERENCES `CobrancasFinanceiras`(`id`)
        ON DELETE SET NULL
        ON UPDATE CASCADE;
