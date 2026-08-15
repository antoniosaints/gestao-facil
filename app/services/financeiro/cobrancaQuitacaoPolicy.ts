import Decimal from "decimal.js";

/**
 * Uma cobrança vinculada só pode concluir automaticamente sua origem quando
 * o próprio valor cobrado cobre o total da venda ou da ordem de serviço.
 * Cobranças menores representam recebimentos parciais, mesmo depois de o
 * gateway confirmar o pagamento.
 */
export function cobrancaCobreValorTotal(
  valorCobranca: Decimal.Value,
  valorTotal: Decimal.Value,
) {
  return new Decimal(valorCobranca).gte(new Decimal(valorTotal));
}
