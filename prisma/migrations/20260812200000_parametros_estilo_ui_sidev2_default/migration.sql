-- Mantém a escolha já salva de cada conta e altera somente o default de novas linhas.
ALTER TABLE `ParametrosConta`
  MODIFY COLUMN `estiloUi` VARCHAR(16) NULL DEFAULT 'SIDEV2';
