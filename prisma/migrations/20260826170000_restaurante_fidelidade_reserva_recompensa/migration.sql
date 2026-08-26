-- Registra as promoções cuja recompensa foi reservada no pedido. Isso permite
-- manter a recompensa indisponível enquanto o pedido está aberto e devolvê-la
-- exatamente ao programa correto caso ele seja cancelado.
ALTER TABLE `RestaurantePedido`
  ADD COLUMN `fidelidadeRecompensasJson` JSON NULL;
