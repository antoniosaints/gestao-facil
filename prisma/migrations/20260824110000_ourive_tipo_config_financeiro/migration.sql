-- Tipifica a OS de ourivesaria e registra os parâmetros financeiros configuráveis.
ALTER TABLE `OuriveConfiguracao`
  ADD COLUMN `percentualLoja` DECIMAL(5, 2) NOT NULL DEFAULT 50.00,
  ADD COLUMN `percentualOurives` DECIMAL(5, 2) NOT NULL DEFAULT 50.00,
  ADD COLUMN `percentualPerdaPadrao` DECIMAL(5, 2) NOT NULL DEFAULT 10.00;

-- O default preserva as ordens existentes como consertos.
ALTER TABLE `OuriveOrdem`
  ADD COLUMN `tipo` ENUM('CONSERTO', 'ENCOMENDA') NOT NULL DEFAULT 'CONSERTO',
  ADD COLUMN `valorMaoObra` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `percentualLojaAplicado` DECIMAL(5, 2) NULL,
  ADD COLUMN `percentualOurivesAplicado` DECIMAL(5, 2) NULL,
  ADD COLUMN `memoriaCalculoFinanceiro` JSON NULL,
  ADD COLUMN `financeiroConsolidadoEm` DATETIME(3) NULL;
