-- O OAuth do Mercado Pago pode devolver uma lista de permissões maior que VARCHAR(191).
-- Preservamos todo o escopo retornado para não falhar após a autorização bem-sucedida.
ALTER TABLE `MercadoPagoOAuthConta` MODIFY `scope` TEXT NULL;
