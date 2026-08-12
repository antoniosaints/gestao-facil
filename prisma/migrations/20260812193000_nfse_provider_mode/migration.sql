-- A escolha do emissor pertence à empresa. O município sozinho não pode mais
-- forçar o legado: São Mateus do Maranhão pode usar o padrão nacional ou D2TI.
ALTER TABLE `NotaFiscalConfiguracao`
  ADD COLUMN `modoEmissaoNfse` VARCHAR(24) NOT NULL DEFAULT 'NACIONAL' AFTER `ambiente`;

-- Preserva as empresas que já usavam a integração D2TI antes desta escolha existir.
UPDATE `NotaFiscalConfiguracao`
SET `modoEmissaoNfse` = 'LEGADO_D2TI'
WHERE `provedorNfse` = 'D2TI_CTA_SAO_MATEUS_MA';
