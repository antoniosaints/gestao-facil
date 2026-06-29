ALTER TABLE `ParametrosConta`
  ADD COLUMN `whatsappNotificacoesAtivo` BOOLEAN NULL DEFAULT false,
  ADD COLUMN `whatsappNotificacoesInstanciaId` INTEGER NULL,
  ADD COLUMN `whatsappEventoNovaVenda` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoNovaOs` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoNovoLancamento` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoNovoCliente` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoComandaFaturada` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoCaixaAberto` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `whatsappEventoCaixaFechado` BOOLEAN NULL DEFAULT true;
