-- Mantém o cancelamento da entrega separado de uma falha operacional.
ALTER TABLE `RestaurantePedido`
  MODIFY `entregaStatus` ENUM('NAO_APLICAVEL','AGUARDANDO_DESPACHO','OFERTADA','ATRIBUIDA','RETIRADA','EM_ROTA','ENTREGUE','FALHOU','CANCELADA') NOT NULL DEFAULT 'NAO_APLICAVEL';

ALTER TABLE `RestauranteEntrega`
  ADD COLUMN `canceladaAt` DATETIME(3) NULL;
