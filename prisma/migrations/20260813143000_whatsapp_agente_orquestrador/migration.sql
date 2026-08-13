-- Mantem o agente que assumiu cada conversa. O vinculo padrao por instancia continua em
-- WhatsAppAgenteInstancia; este campo so e preenchido apos uma transferencia.
ALTER TABLE `WhatsAppConversa`
  ADD COLUMN `agenteId` INTEGER NULL,
  ADD INDEX `WhatsAppConversa_contaId_agenteId_idx`(`contaId`, `agenteId`),
  ADD CONSTRAINT `WhatsAppConversa_agenteId_fkey`
    FOREIGN KEY (`agenteId`) REFERENCES `WhatsAppAgente`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WhatsAppConversaEvento`
  MODIFY `tipo` ENUM('ENFILEIRADA', 'ASSUMIDA', 'FINALIZADA', 'TRANSFERIDA_AGENTE') NOT NULL;
