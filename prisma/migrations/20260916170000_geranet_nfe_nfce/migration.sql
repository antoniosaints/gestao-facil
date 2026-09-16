-- Dados necessários para o contrato Geranet de NF-e/NFC-e.
ALTER TABLE `Produto`
  ADD COLUMN `ean` VARCHAR(14) NULL,
  ADD COLUMN `tipoItem` VARCHAR(2) NULL DEFAULT '00',
  ADD COLUMN `icmsCsosn` VARCHAR(3) NULL,
  ADD COLUMN `icmsCst` VARCHAR(3) NULL,
  ADD COLUMN `pisCst` VARCHAR(2) NULL,
  ADD COLUMN `cofinsCst` VARCHAR(2) NULL;

ALTER TABLE `ProdutoBase`
  ADD COLUMN `ean` VARCHAR(14) NULL,
  ADD COLUMN `tipoItem` VARCHAR(2) NULL DEFAULT '00',
  ADD COLUMN `icmsCsosn` VARCHAR(3) NULL,
  ADD COLUMN `icmsCst` VARCHAR(3) NULL,
  ADD COLUMN `pisCst` VARCHAR(2) NULL,
  ADD COLUMN `cofinsCst` VARCHAR(2) NULL;

ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `nfeNaturezaOperacao` VARCHAR(120) NULL DEFAULT 'Venda de mercadoria',
  ADD COLUMN `nfeTipoAtividade` VARCHAR(1) NULL DEFAULT '1',
  ADD COLUMN `nfeIndicadorPresenca` VARCHAR(1) NULL DEFAULT '1',
  ADD COLUMN `nfeIndicativoIntermediador` VARCHAR(1) NULL DEFAULT '0',
  ADD COLUMN `nfeFrete` VARCHAR(1) NULL DEFAULT '9',
  ADD COLUMN `responsavelTecnicoCnpj` VARCHAR(14) NULL,
  ADD COLUMN `responsavelTecnicoContato` VARCHAR(120) NULL,
  ADD COLUMN `responsavelTecnicoEmail` VARCHAR(191) NULL,
  ADD COLUMN `responsavelTecnicoTelefone` VARCHAR(20) NULL,
  ADD COLUMN `responsavelTecnicoCsrtId` VARCHAR(10) NULL,
  ADD COLUMN `responsavelTecnicoCsrtCifrado` TEXT NULL;
