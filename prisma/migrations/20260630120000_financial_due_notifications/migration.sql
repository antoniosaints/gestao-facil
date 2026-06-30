-- AlterTable
ALTER TABLE `ParametrosConta`
  ADD COLUMN `financeiroVencimentosNotificacoesAtivo` BOOLEAN NULL DEFAULT true;

-- AlterTable
ALTER TABLE `LancamentoFinanceiro`
  ADD COLUMN `notificarVencimento` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `AssinaturaPagar`
  ADD COLUMN `notificarVencimento` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `NotificacaoVencimentoFinanceiro` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `origemTipo` ENUM('LANCAMENTO_PARCELA', 'ASSINATURA_PAGAR') NOT NULL,
  `origemId` INTEGER NOT NULL,
  `marco` ENUM('D3', 'D1', 'D0', 'D1_APOS') NOT NULL,
  `dataReferencia` DATETIME(3) NOT NULL,
  `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `notif_venc_fin_unique`
  ON `NotificacaoVencimentoFinanceiro`(`origemTipo`, `origemId`, `marco`, `dataReferencia`);

-- CreateIndex
CREATE INDEX `notif_venc_fin_conta_sent_idx`
  ON `NotificacaoVencimentoFinanceiro`(`contaId`, `sentAt`);

-- AddForeignKey
ALTER TABLE `NotificacaoVencimentoFinanceiro`
  ADD CONSTRAINT `NotificacaoVencimentoFinanceiro_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
