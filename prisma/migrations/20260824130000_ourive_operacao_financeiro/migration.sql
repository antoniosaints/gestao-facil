-- Evolução incremental do fluxo operacional e financeiro da ourivesaria.
ALTER TABLE `OuriveConfiguracao`
  ADD COLUMN `proLaboreCategoriaId` INTEGER NULL,
  ADD COLUMN `proLaboreContaFinanceiraId` INTEGER NULL;

ALTER TABLE `OuriveOrdem`
  MODIFY COLUMN `status` ENUM(
    'RECEBIDA',
    'ORCAMENTO',
    'AGUARDANDO_MATERIAL',
    'PRONTA_PRODUCAO',
    'PRODUCAO',
    'FINALIZADA',
    'REVISAO',
    'PRONTA_ENTREGA',
    'ENTREGUE',
    'RECUSADA',
    'CANCELADA'
  ) NOT NULL DEFAULT 'RECEBIDA',
  ADD COLUMN `producaoIniciadaEm` DATETIME(3) NULL,
  ADD COLUMN `producaoFinalizadaEm` DATETIME(3) NULL,
  ADD COLUMN `pesoFinal` DECIMAL(12, 3) NULL,
  ADD COLUMN `financeiroReabertoEm` DATETIME(3) NULL,
  ADD COLUMN `financeiroStatus` ENUM('ABERTO', 'CALCULADO', 'CONSOLIDADO', 'PAGO') NOT NULL DEFAULT 'ABERTO';

ALTER TABLE `OuriveEvento`
  MODIFY COLUMN `tipo` ENUM(
    'RECEBIMENTO',
    'FOTO',
    'ORCAMENTO',
    'APROVACAO',
    'RECUSA',
    'RESPONSAVEL',
    'MATERIAL',
    'ETAPA',
    'REVISAO',
    'ENTREGA',
    'CANCELAMENTO',
    'FINANCEIRO',
    'CUSTO_EXTRA',
    'STATUS',
    'PRODUCAO',
    'PAGAMENTO',
    'PROLABORE'
  ) NOT NULL;

CREATE TABLE `OuriveRepasse` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `ordemOuriveId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `valor` DECIMAL(10, 2) NOT NULL,
  `status` ENUM('PENDENTE', 'PAGO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  `pagoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OuriveRepasse_ordemOuriveId_usuarioId_key`(`ordemOuriveId`, `usuarioId`),
  INDEX `OuriveRepasse_contaId_usuarioId_status_idx`(`contaId`, `usuarioId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OurivePagamento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `usuarioId` INTEGER NOT NULL,
  `valorTotal` DECIMAL(10, 2) NOT NULL,
  `dataPagamento` DATETIME(3) NOT NULL,
  `observacao` TEXT NULL,
  `lancamentoFinanceiroId` INTEGER NULL,
  `criadoPorId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `OurivePagamento_lancamentoFinanceiroId_key`(`lancamentoFinanceiroId`),
  INDEX `OurivePagamento_contaId_usuarioId_dataPagamento_idx`(`contaId`, `usuarioId`, `dataPagamento`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OurivePagamentoItem` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `pagamentoId` INTEGER NOT NULL,
  `repasseId` INTEGER NOT NULL,
  `ordemOuriveId` INTEGER NOT NULL,
  `valor` DECIMAL(10, 2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `OurivePagamentoItem_repasseId_key`(`repasseId`),
  INDEX `OurivePagamentoItem_pagamentoId_idx`(`pagamentoId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OuriveProLabore` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `beneficiarioId` INTEGER NOT NULL,
  `competencia` DATETIME(3) NOT NULL,
  `valor` DECIMAL(10, 2) NOT NULL,
  `status` ENUM('PENDENTE', 'PAGO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  `observacao` TEXT NULL,
  `dataPagamento` DATETIME(3) NULL,
  `lancamentoFinanceiroId` INTEGER NULL,
  `criadoPorId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `OuriveProLabore_lancamentoFinanceiroId_key`(`lancamentoFinanceiroId`),
  INDEX `OuriveProLabore_contaId_competencia_status_idx`(`contaId`, `competencia`, `status`),
  INDEX `OuriveProLabore_contaId_beneficiarioId_idx`(`contaId`, `beneficiarioId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
