ALTER TABLE `RestauranteConfig`
    ADD COLUMN `whatsappNotificacoesInstanciaId` INTEGER NULL;

-- Mantém a instância já usada pelos restaurantes existentes; a configuração passa
-- a ser administrada na aba Mensagens do próprio Restaurante.
UPDATE `RestauranteConfig` AS restaurante
INNER JOIN `ParametrosConta` AS parametros ON parametros.`contaId` = restaurante.`contaId`
SET restaurante.`whatsappNotificacoesInstanciaId` = parametros.`whatsappNotificacoesInstanciaId`
WHERE restaurante.`whatsappNotificacoesInstanciaId` IS NULL
  AND parametros.`whatsappNotificacoesInstanciaId` IS NOT NULL;
