import Decimal from "decimal.js";
import dayjs from "dayjs";

export type ParcelaStatusInput = {
  pago: boolean;
  vencimento: Date | string;
};

export type ParcelaValorInput = {
  valor: Decimal.Value;
};

export function canDeleteParcelaFinanceira(parcela: { pago: boolean }) {
  return !parcela.pago;
}

export function sumParcelasFinanceiras(parcelas: ParcelaValorInput[]) {
  return parcelas.reduce((acc, parcela) => acc.plus(new Decimal(parcela.valor || 0)), new Decimal(0));
}

export function resolveLancamentoStatusFromParcelas(
  parcelas: ParcelaStatusInput[],
  referenceDate: Date = new Date(),
) {
  if (!parcelas.length) return "PENDENTE" as const;

  const hoje = dayjs(referenceDate).startOf("day").toDate();
  const totalParcelas = parcelas.length;
  const parcelasPagas = parcelas.filter((parcela) => parcela.pago).length;
  const parcelasVencidas = parcelas.filter(
    (parcela) => !parcela.pago && dayjs(parcela.vencimento).isBefore(hoje),
  ).length;

  if (parcelasPagas === totalParcelas) return "PAGO" as const;
  if (parcelasPagas > 0 && parcelasPagas < totalParcelas) return "PARCIAL" as const;
  if (parcelasVencidas > 0) return "ATRASADO" as const;
  return "PENDENTE" as const;
}
