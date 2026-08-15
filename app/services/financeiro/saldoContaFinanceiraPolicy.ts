import Decimal from "decimal.js";

export type MovimentacaoSaldoConta = {
  contaFinanceira: number | null;
  valor: unknown;
  valorPago?: unknown | null;
  pago: boolean;
  dataPagamento: Date | null;
  lancamento: {
    tipo: "RECEITA" | "DESPESA";
    contasFinanceiroId: number | null;
  };
};

export type TotaisSaldoConta = {
  entradasRealizadas: number;
  saidasRealizadas: number;
  variacao: number;
};

function toDecimal(value: unknown) {
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  if (value && typeof value === "object" && "toString" in value) return new Decimal(String(value));
  return new Decimal(0);
}

/**
 * Replica a regra do resumo financeiro para distribuir o saldo realizado entre
 * as contas, sem alterar os registros existentes.
 */
export function calcularMovimentacoesRealizadasPorConta(
  parcelas: MovimentacaoSaldoConta[],
  referencia: Date,
) {
  const totais = new Map<number, {
    entradasRealizadas: Decimal;
    saidasRealizadas: Decimal;
  }>();

  for (const parcela of parcelas) {
    if (!parcela.pago || !parcela.dataPagamento || parcela.dataPagamento > referencia) continue;

    const contaFinanceiraId = parcela.contaFinanceira ?? parcela.lancamento.contasFinanceiroId;
    if (!contaFinanceiraId) continue;

    const atual = totais.get(contaFinanceiraId) ?? {
      entradasRealizadas: new Decimal(0),
      saidasRealizadas: new Decimal(0),
    };
    const valor = toDecimal(parcela.valor);

    if (parcela.lancamento.tipo === "RECEITA") {
      atual.entradasRealizadas = atual.entradasRealizadas.plus(valor);
    } else {
      atual.saidasRealizadas = atual.saidasRealizadas.plus(valor);
    }

    totais.set(contaFinanceiraId, atual);
  }

  return new Map<number, TotaisSaldoConta>(
    Array.from(totais.entries()).map(([contaFinanceiraId, total]) => [
      contaFinanceiraId,
      {
        entradasRealizadas: total.entradasRealizadas.toNumber(),
        saidasRealizadas: total.saidasRealizadas.toNumber(),
        variacao: total.entradasRealizadas.minus(total.saidasRealizadas).toNumber(),
      },
    ]),
  );
}
