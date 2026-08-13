-- Instâncias removidas são desativadas para manter histórico. Elas não podem continuar
-- vinculadas a um agente padrão; limpa os vínculos legados antes do novo fluxo.
DELETE `link`
FROM `WhatsAppAgenteInstancia` AS `link`
INNER JOIN `WhatsAppInstancia` AS `instancia` ON `instancia`.`id` = `link`.`instanciaId`
WHERE `instancia`.`ativo` = false;
