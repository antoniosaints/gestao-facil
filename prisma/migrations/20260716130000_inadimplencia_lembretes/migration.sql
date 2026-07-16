-- CreateTable
CREATE TABLE `ClienteLembreteConfig` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `clienteId` INTEGER NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true,
  `diasLembrete` JSON NOT NULL,
  `canalWhatsapp` BOOLEAN NOT NULL DEFAULT true,
  `canalEmail` BOOLEAN NOT NULL DEFAULT false,
  `canalSms` BOOLEAN NOT NULL DEFAULT false,
  `mensagemCustom` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ClienteLembreteConfig_clienteId_key`(`clienteId`),
  INDEX `ClienteLembreteConfig_contaId_idx`(`contaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LancamentoLembreteCliente` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `lancamentoId` INTEGER NOT NULL,
  `ativo` BOOLEAN NOT NULL DEFAULT true,
  `diasLembrete` JSON NOT NULL,
  `canalWhatsapp` BOOLEAN NOT NULL DEFAULT true,
  `canalEmail` BOOLEAN NOT NULL DEFAULT false,
  `canalSms` BOOLEAN NOT NULL DEFAULT false,
  `mensagemCustom` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `LancamentoLembreteCliente_lancamentoId_key`(`lancamentoId`),
  INDEX `LancamentoLembreteCliente_contaId_idx`(`contaId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LembreteInadimplenciaEnviado` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `parcelaId` INTEGER NOT NULL,
  `diaOffset` INTEGER NOT NULL,
  `canal` ENUM('WHATSAPP', 'EMAIL', 'SMS') NOT NULL DEFAULT 'WHATSAPP',
  `dataReferencia` DATETIME(3) NOT NULL,
  `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `lembrete_inad_unique`(`parcelaId`, `diaOffset`, `canal`, `dataReferencia`),
  INDEX `lembrete_inad_conta_sent_idx`(`contaId`, `sentAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClienteLembreteConfig`
  ADD CONSTRAINT `ClienteLembreteConfig_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClienteLembreteConfig`
  ADD CONSTRAINT `ClienteLembreteConfig_clienteId_fkey`
  FOREIGN KEY (`clienteId`) REFERENCES `ClientesFornecedores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoLembreteCliente`
  ADD CONSTRAINT `LancamentoLembreteCliente_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LancamentoLembreteCliente`
  ADD CONSTRAINT `LancamentoLembreteCliente_lancamentoId_fkey`
  FOREIGN KEY (`lancamentoId`) REFERENCES `LancamentoFinanceiro`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LembreteInadimplenciaEnviado`
  ADD CONSTRAINT `LembreteInadimplenciaEnviado_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
