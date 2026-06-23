-- Add monthly payment control for WhatsApp instances.
CREATE TABLE `WhatsAppInstanciaPagamento` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `contaId` INTEGER NOT NULL,
  `instanciaId` INTEGER NOT NULL,
  `metodo` ENUM('PIX', 'CARTAO') NOT NULL,
  `status` ENUM('PENDENTE', 'PAGO', 'FALHOU', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  `payerEmail` VARCHAR(191) NOT NULL,
  `webhookPaymentUrl` TEXT NULL,
  `paymentId` VARCHAR(191) NULL,
  `sessionId` VARCHAR(191) NULL,
  `qrCodeBase64` LONGTEXT NULL,
  `qrCodeCopyPaste` LONGTEXT NULL,
  `ticketUrl` TEXT NULL,
  `checkoutUrl` TEXT NULL,
  `rawPayload` LONGTEXT NULL,
  `pagoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `wa_pagto_conta_inst_status_created_idx`(`contaId`, `instanciaId`, `status`, `createdAt`),
  INDEX `wa_pagto_payment_id_idx`(`paymentId`),
  INDEX `wa_pagto_session_id_idx`(`sessionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppInstanciaPagamento`
  ADD CONSTRAINT `WhatsAppInstanciaPagamento_contaId_fkey`
  FOREIGN KEY (`contaId`) REFERENCES `Contas`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `WhatsAppInstanciaPagamento`
  ADD CONSTRAINT `WhatsAppInstanciaPagamento_instanciaId_fkey`
  FOREIGN KEY (`instanciaId`) REFERENCES `WhatsAppInstancia`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
