import Decimal from "decimal.js";

type PagamentoVenda = {
  metodo: string;
  valor: Decimal.Value;
  detalhes?: unknown;
};

export type PartePagamentoVenda = {
  metodo: string;
  valor: Decimal;
};

function toDecimal(value: unknown) {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    return decimal.gte(0) ? decimal : null;
  } catch {
    return null;
  }
}

/**
 * Decompõe pagamentos compostos para relatórios. O campo principal continua
 * sendo mantido por compatibilidade, enquanto `detalhes` preserva cada método
 * e o respectivo valor da venda.
 */
export function getPartesPagamentoVenda(
  pagamento: PagamentoVenda,
): PartePagamentoVenda[] {
  if (Array.isArray(pagamento.detalhes)) {
    const partes = pagamento.detalhes.flatMap((detalhe: any) => {
      const valor = toDecimal(detalhe?.valor);
      if (!valor) return [];

      return [{
        metodo: String(detalhe?.metodo || "OUTRO"),
        valor,
      }];
    });

    if (partes.length) return partes;
  }

  const valor = toDecimal(pagamento.valor);
  if (!valor) return [];

  return [{ metodo: pagamento.metodo, valor }];
}

export function somarPagamentosPorMetodo(
  pagamentos: PagamentoVenda[],
) {
  const totais = new Map<string, Decimal>();

  for (const pagamento of pagamentos) {
    for (const parte of getPartesPagamentoVenda(pagamento)) {
      totais.set(
        parte.metodo,
        (totais.get(parte.metodo) || new Decimal(0)).plus(parte.valor),
      );
    }
  }

  return totais;
}
