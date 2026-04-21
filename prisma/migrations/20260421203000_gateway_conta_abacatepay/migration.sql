ALTER TABLE `Contas`
  MODIFY `gateway` ENUM('mercadopago', 'abacatepay', 'asaass') NOT NULL DEFAULT 'mercadopago';
