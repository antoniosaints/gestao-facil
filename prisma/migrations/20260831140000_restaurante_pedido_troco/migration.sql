-- Preserve the cash amount informed by the customer so delivery receipts can
-- tell the courier exactly how much change to take.
ALTER TABLE `RestaurantePedido`
  ADD COLUMN `trocoParaSnapshot` DECIMAL(10, 2) NULL;
