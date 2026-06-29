import Decimal from "decimal.js";

type ActiveCaixaRef = { caixaId: number } | null;

export type CaixaMovementType =
  | "ABERTURA"
  | "VENDA"
  | "SANGRIA"
  | "REFORCO"
  | "ESTORNO"
  | "FECHAMENTO";

export function canUserEnterCaixa(
  activeCaixa: ActiveCaixaRef,
  targetCaixaId: number
) {
  return !activeCaixa || activeCaixa.caixaId === targetCaixaId;
}

export function getMovementSignedValue(
  tipo: CaixaMovementType,
  valor: Decimal
) {
  if (tipo === "SANGRIA" || tipo === "ESTORNO") {
    return valor.negated();
  }

  if (tipo === "FECHAMENTO") {
    return new Decimal(0);
  }

  return valor;
}

export function calculateCaixaSaldoEsperado(
  saldoInicial: Decimal,
  movimentos: Array<{ tipo: CaixaMovementType; valor: Decimal }>
) {
  return movimentos.reduce(
    (total, movimento) =>
      total.plus(getMovementSignedValue(movimento.tipo, movimento.valor)),
    saldoInicial
  );
}

export function getCaixaMovimentoVendaCleanupWhere(
  contaId: number,
  vendaId: number
) {
  return {
    contaId,
    vendaId,
  };
}

export function getSaldoAdjustmentForDeletedSaleMovements(
  movimentos: Array<{
    tipo: CaixaMovementType;
    metodoPagamento?: string | null;
    valor: Decimal | number | string;
  }>
) {
  return movimentos.reduce((total, movimento) => {
    if (movimento.tipo === "VENDA" && movimento.metodoPagamento === "DINHEIRO") {
      return total.minus(new Decimal(movimento.valor));
    }

    return total;
  }, new Decimal(0));
}

export function shouldReportCaixaMovimento(movimento: {
  tipo: CaixaMovementType;
  vendaId?: number | null;
}) {
  return (
    movimento.tipo !== "VENDA" ||
    (movimento.vendaId !== null && movimento.vendaId !== undefined)
  );
}

export function buildCaixaPdfFilename(codigo: string) {
  const safeCodigo = codigo.replace(/[^\w.-]+/g, "-");
  return `caixa-${safeCodigo}.pdf`;
}

export function canDeleteCaixa(input: {
  isAdmin: boolean;
  linkedSalesCount: number;
}) {
  return input.isAdmin && input.linkedSalesCount === 0;
}
