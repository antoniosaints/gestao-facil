-- Parâmetros próprios do leiaute NFS-e da Geranet. Os códigos nacional,
-- municipal e CNAE são distintos e não devem ser reutilizados implicitamente.
ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `nfseCodigoServicoNacional` VARCHAR(16) NULL,
  ADD COLUMN `nfseCodigoTributacaoMunicipio` VARCHAR(32) NULL,
  ADD COLUMN `nfseCodigoCnae` VARCHAR(16) NULL,
  ADD COLUMN `nfseDataOpcaoSimples` DATETIME(3) NULL,
  ADD COLUMN `nfseRegimeApuracaoSn` VARCHAR(1) NULL DEFAULT '1',
  ADD COLUMN `nfseIssRetido` VARCHAR(1) NULL DEFAULT '2',
  ADD COLUMN `nfseResponsavelRetencao` VARCHAR(1) NULL DEFAULT '4',
  ADD COLUMN `nfseNaturezaOperacao` VARCHAR(1) NULL DEFAULT '1',
  ADD COLUMN `nfseIncentivadorCultural` VARCHAR(1) NULL DEFAULT '2',
  ADD COLUMN `nfseExigibilidadeIss` VARCHAR(1) NULL DEFAULT '1';
