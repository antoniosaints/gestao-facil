-- Receitas de OS de ourive já entregues representam valores realizados.
-- Corrige somente lançamentos ainda pendentes, preservando pagamentos já registrados.
UPDATE `LancamentoFinanceiro` AS lancamento
INNER JOIN `OuriveOrdem` AS ordem ON ordem.`receitaLancamentoId` = lancamento.`id`
SET
  lancamento.`status` = 'PAGO',
  lancamento.`dataEntrada` = COALESCE(
    lancamento.`dataEntrada`,
    ordem.`entregueEm`,
    ordem.`faturadaEm`,
    lancamento.`dataLancamento`
  )
WHERE ordem.`faturadaEm` IS NOT NULL
  AND lancamento.`tipo` = 'RECEITA'
  AND lancamento.`status` <> 'PAGO';

UPDATE `ParcelaFinanceiro` AS parcela
INNER JOIN `LancamentoFinanceiro` AS lancamento ON lancamento.`id` = parcela.`lancamentoId`
INNER JOIN `OuriveOrdem` AS ordem ON ordem.`receitaLancamentoId` = lancamento.`id`
SET
  parcela.`pago` = TRUE,
  parcela.`valorPago` = COALESCE(parcela.`valorPago`, parcela.`valor`),
  parcela.`formaPagamento` = COALESCE(parcela.`formaPagamento`, 'OUTRO'),
  parcela.`dataPagamento` = COALESCE(
    parcela.`dataPagamento`,
    ordem.`entregueEm`,
    ordem.`faturadaEm`,
    lancamento.`dataLancamento`
  )
WHERE ordem.`faturadaEm` IS NOT NULL
  AND lancamento.`tipo` = 'RECEITA'
  AND parcela.`pago` = FALSE;
