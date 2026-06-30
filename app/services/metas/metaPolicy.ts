import Decimal from "decimal.js";
import {
  addMonths,
  addQuarters,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
} from "date-fns";

export type TipoMeta = "VENDAS" | "SERVICOS" | "FINANCEIRO";
export type MetricaMeta = "VALOR" | "QUANTIDADE";
export type PeriodicidadeMeta = "MENSAL" | "TRIMESTRAL" | "ANUAL" | "PERSONALIZADO";

export type MetaPeriodoInput = {
  periodicidade: PeriodicidadeMeta;
  dataInicio: Date | string;
  dataFim?: Date | string | null;
};

export type MetaProgressInput = {
  valorAtual: Decimal.Value;
  valorAlvo: Decimal.Value;
};

export function canManageMetas(permissao?: string | null) {
  return permissao === "root" || permissao === "admin";
}

export function getMetaPeriodWindow(meta: MetaPeriodoInput, referenceDate: Date = new Date()) {
  const dataInicio = startOfDay(new Date(meta.dataInicio));
  const dataFim = meta.dataFim ? startOfDay(new Date(meta.dataFim)) : null;
  const reference = dataFim && referenceDate > dataFim ? dataFim : referenceDate;

  if (meta.periodicidade === "PERSONALIZADO") {
    return {
      inicio: dataInicio,
      fim: dataFim ? endOfDaySafe(dataFim) : endOfDaySafe(reference),
      label: "Personalizado",
    };
  }

  if (meta.periodicidade === "TRIMESTRAL") {
    const inicio = maxDate(startOfQuarter(reference), dataInicio);
    return {
      inicio,
      fim: minDate(endOfQuarter(reference), dataFim),
      label: getQuarterLabel(reference),
    };
  }

  if (meta.periodicidade === "ANUAL") {
    const inicio = maxDate(startOfYear(reference), dataInicio);
    return {
      inicio,
      fim: minDate(endOfYear(reference), dataFim),
      label: String(reference.getFullYear()),
    };
  }

  const inicio = maxDate(startOfMonth(reference), dataInicio);
  return {
    inicio,
    fim: minDate(endOfMonth(reference), dataFim),
    label: reference.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }),
  };
}

export function getMetaHistoryWindows(meta: MetaPeriodoInput, referenceDate: Date = new Date(), limit = 12) {
  if (meta.periodicidade === "PERSONALIZADO") {
    return [getMetaPeriodWindow(meta, referenceDate)];
  }

  const windows = [];
  const maxItems = Math.max(1, Math.min(limit, 24));

  for (let i = maxItems - 1; i >= 0; i -= 1) {
    const ref =
      meta.periodicidade === "ANUAL"
        ? addYears(referenceDate, -i)
        : meta.periodicidade === "TRIMESTRAL"
          ? addQuarters(referenceDate, -i)
          : subMonths(referenceDate, i);

    const window = getMetaPeriodWindow(meta, ref);
    if (window.fim >= startOfDay(new Date(meta.dataInicio))) {
      windows.push(window);
    }
  }

  return windows;
}

export function calculateMetaProgress(input: MetaProgressInput) {
  const valorAtual = new Decimal(input.valorAtual || 0);
  const valorAlvo = new Decimal(input.valorAlvo || 0);

  if (valorAlvo.lte(0)) {
    return {
      valorAtual,
      valorAlvo,
      percentual: 0,
      atingida: false,
      restante: new Decimal(0),
    };
  }

  const percentual = Decimal.min(valorAtual.div(valorAlvo).times(100), 100).toDecimalPlaces(2);
  return {
    valorAtual,
    valorAlvo,
    percentual: percentual.toNumber(),
    atingida: valorAtual.gte(valorAlvo),
    restante: Decimal.max(valorAlvo.minus(valorAtual), 0),
  };
}

function endOfDaySafe(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function maxDate(left: Date, right: Date) {
  return left > right ? left : right;
}

function minDate(left: Date, right?: Date | null) {
  if (!right) return left;
  return left < right ? left : endOfDaySafe(right);
}

function getQuarterLabel(date: Date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${quarter}o tri/${date.getFullYear()}`;
}
