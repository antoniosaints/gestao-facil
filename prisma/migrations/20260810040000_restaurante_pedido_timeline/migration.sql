ALTER TABLE `RestaurantePedido`
  ADD COLUMN `confirmadoAt` DATETIME(3) NULL,
  ADD COLUMN `emPreparoAt` DATETIME(3) NULL,
  ADD COLUMN `prontoAt` DATETIME(3) NULL;
