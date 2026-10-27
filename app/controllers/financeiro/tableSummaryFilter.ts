import type { Prisma } from "../../../generated";

const cards = {
  RECEBIDO: { tipo: "RECEITA", pago: true },
  PAGO: { tipo: "DESPESA", pago: true },
  A_RECEBER: { tipo: "RECEITA", pago: false },
  A_PAGAR: { tipo: "DESPESA", pago: false },
} as const;
export interface FinanceSummaryScope {
  tipo: "RECEITA" | "DESPESA";
  pago: boolean;
  dateField: "dataPagamento" | "vencimento";
  inicio: Date;
  fim: Date;
  where: Prisma.ParcelaFinanceiroWhereInput;
}
export function getFinanceSummaryScope(
  value: unknown,
  period: { inicio?: Date; fim?: Date },
): FinanceSummaryScope | undefined {
  if (
    typeof value !== "string" ||
    !Object.prototype.hasOwnProperty.call(cards, value) ||
    !period.inicio ||
    !period.fim
  )
    return undefined;
  const card = cards[value as keyof typeof cards];
  const dateField = card.pago ? "dataPagamento" : "vencimento";
  return {
    ...card,
    dateField,
    inicio: period.inicio,
    fim: period.fim,
    where: {
      ignorado: false,
      pago: card.pago,
      [dateField]: { gte: period.inicio, lte: period.fim },
    },
  };
}
export function summarizeMatchingParcels(
  parcels: readonly {
    ignorado: boolean;
    pago: boolean;
    valor: unknown;
    vencimento: Date;
    dataPagamento: Date | null;
  }[],
  scope: FinanceSummaryScope,
) {
  const matches = parcels.filter((part) => {
    const date = part[scope.dateField];
    return (
      !part.ignorado &&
      part.pago === scope.pago &&
      date &&
      date >= scope.inicio &&
      date <= scope.fim
    );
  });
  return {
    valorResumo:
      matches.reduce(
        (sum, part) => sum + Math.round(Number(part.valor) * 100),
        0,
      ) / 100,
    parcelasResumo: matches.length,
  };
}
