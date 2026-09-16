-- Matriz fiscal por produto/variante: campos opcionais, aplicados somente
-- quando o CST/CSOSN e a operação exigirem o respectivo grupo tributário.
ALTER TABLE `Produto`
  ADD COLUMN `icmsModBcSt` VARCHAR(1) NULL,
  ADD COLUMN `icmsMva` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsReducaoBcSt` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsAliquotaSt` DECIMAL(7,4) NULL,
  ADD COLUMN `fcpAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `fcpStAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsDesoneradoValor` DECIMAL(12,2) NULL,
  ADD COLUMN `icmsDesoneradoMotivo` VARCHAR(2) NULL,
  ADD COLUMN `icmsCreditoAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `ipiCst` VARCHAR(2) NULL,
  ADD COLUMN `ipiCodigoEnquadramento` VARCHAR(3) NULL,
  ADD COLUMN `difalAliquotaInterna` DECIMAL(7,4) NULL,
  ADD COLUMN `difalFcpAliquota` DECIMAL(7,4) NULL;

ALTER TABLE `ProdutoBase`
  ADD COLUMN `icmsModBcSt` VARCHAR(1) NULL,
  ADD COLUMN `icmsMva` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsReducaoBcSt` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsAliquotaSt` DECIMAL(7,4) NULL,
  ADD COLUMN `fcpAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `fcpStAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `icmsDesoneradoValor` DECIMAL(12,2) NULL,
  ADD COLUMN `icmsDesoneradoMotivo` VARCHAR(2) NULL,
  ADD COLUMN `icmsCreditoAliquota` DECIMAL(7,4) NULL,
  ADD COLUMN `ipiCst` VARCHAR(2) NULL,
  ADD COLUMN `ipiCodigoEnquadramento` VARCHAR(3) NULL,
  ADD COLUMN `difalAliquotaInterna` DECIMAL(7,4) NULL,
  ADD COLUMN `difalFcpAliquota` DECIMAL(7,4) NULL;

ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `nfseRegimeEspecialTributacao` VARCHAR(2) NULL DEFAULT '1';
