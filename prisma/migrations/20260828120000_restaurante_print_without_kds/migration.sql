ALTER TABLE `RestauranteTrabalhoImpressao`
  DROP FOREIGN KEY `RestauranteTrabalhoImpressao_pontoId_fkey`,
  DROP FOREIGN KEY `RestauranteTrabalhoImpressao_ticketId_fkey`;

ALTER TABLE `RestauranteTrabalhoImpressao`
  ADD COLUMN `pedidoId` INTEGER NULL,
  MODIFY `pontoId` INTEGER NULL,
  MODIFY `ticketId` INTEGER NULL;

CREATE INDEX `rest_print_job_order_created_idx`
  ON `RestauranteTrabalhoImpressao`(`pedidoId`, `createdAt`);

ALTER TABLE `RestauranteTrabalhoImpressao`
  ADD CONSTRAINT `RestauranteTrabalhoImpressao_pedidoId_fkey`
    FOREIGN KEY (`pedidoId`) REFERENCES `RestaurantePedido`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RestauranteTrabalhoImpressao_pontoId_fkey`
    FOREIGN KEY (`pontoId`) REFERENCES `RestaurantePontoProducao`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RestauranteTrabalhoImpressao_ticketId_fkey`
    FOREIGN KEY (`ticketId`) REFERENCES `RestauranteTicketProducao`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
