-- CreateTable
CREATE TABLE `LancamentoRecorrencia` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `lancamentoId` INTEGER NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true,
  `valorParcela` DECIMAL(10, 2) NOT NULL,
  `frequencia` ENUM('DIARIO', 'SEMANAL', 'QUINZENAL', 'MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO') NOT NULL DEFAULT 'MENSAL',
  `intervaloDias` INTEGER NULL,
  `dataInicio` DATETIME(3) NOT NULL,
  `dataFim` DATETIME(3) NULL,
  `minimoGerado` INTEGER NOT NULL DEFAULT 1,
  `maximoEmAberto` INTEGER NOT NULL DEFAULT 6,
  `geracaoAutomatica` BOOLEAN NOT NULL DEFAULT false,
  `diasAntecedencia` INTEGER NOT NULL DEFAULT 30,
  `proximoVencimento` DATETIME(3) NULL,
  `totalGerado` INTEGER NOT NULL DEFAULT 0,
  `ultimaGeracaoEm` DATETIME(3) NULL,
  `encerradaEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `LancamentoRecorrencia_lancamentoId_key`(`lancamentoId`),
  INDEX `LancamentoRecorrencia_contaId_ativo_proximoVencimento_idx`(`contaId`, `ativo`, `proximoVencimento`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LancamentoRecorrencia`
  ADD CONSTRAINT `LancamentoRecorrencia_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoRecorrencia`
  ADD CONSTRAINT `LancamentoRecorrencia_lancamentoId_fkey`
  FOREIGN KEY (`lancamentoId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
