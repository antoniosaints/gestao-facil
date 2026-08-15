ALTER TABLE `RestauranteConfig`
  ADD COLUMN `whatsappNotificacoesJson` JSON NULL;

ALTER TABLE `RestaurantePedido`
  ADD COLUMN `whatsappNotificacoesJson` JSON NULL;
