ALTER TABLE `ParametrosConta`
  ADD COLUMN `eventoProdutoAlterado` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `permitirLancamentoRetroativo` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `permitirEfetivacaoFutura` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `permitirTransferenciaContaFinanceira` BOOLEAN NULL DEFAULT true,
  ADD COLUMN `permitirCriacaoCobranca` BOOLEAN NULL DEFAULT true;
