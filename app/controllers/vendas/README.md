# Pagamentos de vendas

`PagamentoVendas` continua sendo o resumo compatível de uma venda. A decomposição de pagamentos compostos é persistida em `PagamentoVendas.detalhes`.

Os painéis e gráficos de vendas devem usar `detalhes` para somar cada forma de pagamento. O método-resumo `OUTRO` não deve aparecer no relatório quando a venda tiver as partes discriminadas.

No fechamento do PDV, cada recebimento imediato é registrado como movimento de caixa. Somente a parte em dinheiro altera `saldoEsperado`; a parte em crediário cria um lançamento financeiro parcelado para o saldo pendente.
