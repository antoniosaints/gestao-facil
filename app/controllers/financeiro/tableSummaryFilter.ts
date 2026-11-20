import type { Prisma } from "../../../generated";
import { contaFinanceiraEfetivaId, parcelaDaContaFinanceira, parcelaDeContaContabilizada } from "../../services/financeiro/contaFinanceiraCalculosPolicy";

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
  contaFinanceiraId?: number;
}
export function getFinanceSummaryScope(
  value: unknown,
  period: { inicio?: Date; fim?: Date; contaFinanceiraId?: number },
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
    contaFinanceiraId: period.contaFinanceiraId,
    where: {
      ignorado: false,
      AND: [
        parcelaDeContaContabilizada,
        ...(period.contaFinanceiraId ? [parcelaDaContaFinanceira(period.contaFinanceiraId)] : []),
      ],
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
    contaFinanceira?: number | null;
  }[],
  scope: FinanceSummaryScope,
  contasIgnoradas: ReadonlySet<number> = new Set(),
  contasFinanceiroId: number | null = null,
) {
  const matches = parcels.filter((part) => {
    const date = part[scope.dateField];
    const contaId = contaFinanceiraEfetivaId({
      contaFinanceira: part.contaFinanceira ?? null,
      lancamento: { contasFinanceiroId },
    });
    return (
      !part.ignorado &&
      (contaId === null || !contasIgnoradas.has(contaId)) &&
      (scope.contaFinanceiraId === undefined || contaId === scope.contaFinanceiraId) &&
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
