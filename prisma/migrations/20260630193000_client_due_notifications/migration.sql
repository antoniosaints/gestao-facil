-- AlterTable
ALTER TABLE `LancamentoFinanceiro`
  ADD COLUMN `notificarClienteVencimento` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `NotificacaoVencimentoFinanceiro`
  MODIFY `origemTipo` ENUM('LANCAMENTO_PARCELA', 'CLIENTE_LANCAMENTO_PARCELA', 'ASSINATURA_PAGAR') NOT NULL,
  ADD COLUMN `canal` ENUM('WHATSAPP', 'EMAIL', 'SMS') NOT NULL DEFAULT 'WHATSAPP';

-- RecreateIndex
DROP INDEX `notif_venc_fin_unique` ON `NotificacaoVencimentoFinanceiro`;

CREATE UNIQUE INDEX `notif_venc_fin_unique`
  ON `NotificacaoVencimentoFinanceiro`(`origemTipo`, `origemId`, `marco`, `canal`, `dataReferencia`);
