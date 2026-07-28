import Decimal from "decimal.js";

export type ReservaPoliticaPagamentoValue =
  | "NENHUM"
  | "INTEGRAL"
  | "SINAL_FIXO"
  | "SINAL_PERCENTUAL";

export type ReservaStatusValue =
  | "AGUARDANDO_PAGAMENTO"
  | "CONFIRMADA"
  | "CONCLUIDA"
  | "CANCELADA"
  | "EXPIRADA";

const TRANSITIONS: Record<ReservaStatusValue, ReservaStatusValue[]> = {
  AGUARDANDO_PAGAMENTO: ["CONFIRMADA", "CANCELADA", "EXPIRADA"],
  CONFIRMADA: ["CONCLUIDA", "CANCELADA"],
  CONCLUIDA: [],
  CANCELADA: [],
  EXPIRADA: [],
};

export const RESERVA_TEMPLATE_VARIABLES = new Set([
  "cliente",
  "empresa",
  "servico",
  "recurso",
  "data",
  "hora",
  "valor",
  "link_pagamento",
  "link_reserva",
]);

export function calculateReservationPayment(input: {
  total: Decimal.Value;
  policy: ReservaPoliticaPagamentoValue;
  fixedDeposit?: Decimal.Value | null;
  percentageDeposit?: Decimal.Value | null;
}) {
  const total = new Decimal(input.total).toDecimalPlaces(2);
  if (total.isNegative()) throw new Error("O valor do serviço não pode ser negativo.");

  if (input.policy === "NENHUM") return new Decimal(0);
  if (input.policy === "INTEGRAL") return total;

  if (input.policy === "SINAL_FIXO") {
    const fixed = new Decimal(input.fixedDeposit || 0).toDecimalPlaces(2);
    if (fixed.lte(0) || fixed.gt(total)) {
      throw new Error("O sinal fixo deve ser maior que zero e não pode superar o serviço.");
    }
    return fixed;
  }

  const percentage = new Decimal(input.percentageDeposit || 0);
  if (percentage.lte(0) || percentage.gte(100)) {
    throw new Error("O percentual do sinal deve ser maior que zero e menor que 100.");
  }
  return total.mul(percentage).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function assertReservationTransition(
  current: ReservaStatusValue,
  next: ReservaStatusValue,
) {
  if (current === next) return;
  if (!TRANSITIONS[current].includes(next)) {
    throw new Error(`Transição de reserva inválida: ${current} para ${next}.`);
  }
}

export function assertCanceledReservationCanBeDeleted(status: ReservaStatusValue) {
  if (status !== "CANCELADA") {
    throw new Error("Somente reservas canceladas podem ser excluídas.");
  }
}

export function renderReservationTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
) {
  const unknown = new Set<string>();
  const rendered = template.replace(/\{([a-z_]+)\}/gi, (_match, key: string) => {
    const normalized = key.toLowerCase();
    if (!RESERVA_TEMPLATE_VARIABLES.has(normalized)) {
      unknown.add(normalized);
      return `{${key}}`;
    }
    return String(variables[normalized] ?? "");
  });
  if (unknown.size) {
    throw new Error(`Variáveis de mensagem inválidas: ${Array.from(unknown).join(", ")}.`);
  }
  return rendered.trim();
}

export function normalizeReservationPhone(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function canChangePublicReservation(startAt: Date, cutoffHours: number, now = new Date()) {
  return startAt.getTime() - now.getTime() >= cutoffHours * 60 * 60 * 1000;
}
