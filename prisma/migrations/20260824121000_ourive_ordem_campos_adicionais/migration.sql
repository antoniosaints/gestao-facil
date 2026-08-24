-- Complementa instalações em que a migration de tipificação da OS já havia sido aplicada
-- antes da inclusão destes campos opcionais.
ALTER TABLE `OuriveOrdem`
  ADD COLUMN `observacoes` TEXT NULL,
  ADD COLUMN `prazoPrevisto` DATETIME(3) NULL;
