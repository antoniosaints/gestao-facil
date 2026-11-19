ALTER TABLE `ParametrosConta`
  ADD COLUMN `whatsappEventoVendaConcluida` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoEstoqueBaixo` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `whatsappEventoProdutoAlterado` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `whatsappEventoSangria` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `whatsappEventoVencimentoFinanceiro` BOOLEAN NULL DEFAULT true;

-- A conclusão no PDV usava a preferência de nova venda. Preserve a escolha existente.
UPDATE `ParametrosConta`
SET `whatsappEventoVendaConcluida` = COALESCE(`whatsappEventoNovaVenda`, true);
