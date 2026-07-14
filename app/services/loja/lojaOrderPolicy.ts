import { CommerceError } from "./commerceError";

const transitions: Record<string, string[]> = {
  RECEBIDO: ["CONFIRMADO", "CANCELADO", "EXPIRADO", "REVISAO"],
  CONFIRMADO: ["PREPARANDO", "CANCELADO", "CANCELAMENTO_PENDENTE"],
  PREPARANDO: ["DESPACHADO", "CANCELADO", "CANCELAMENTO_PENDENTE"],
  DESPACHADO: ["CONCLUIDO"],
  CANCELAMENTO_PENDENTE: ["CANCELADO"],
  REVISAO: ["CANCELAMENTO_PENDENTE"],
};

export function assertOrderTransition(current: string, next: string) {
  if (current === next) return;
  if (!transitions[current]?.includes(next)) {
    throw new CommerceError("invalid_order_transition", `Não é possível alterar o pedido de ${current} para ${next}`);
  }
}

export function reservationDurationMs(channel: "WHATSAPP" | "GATEWAY") {
  return channel === "GATEWAY" ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export function nextCancellationStatus(paymentStatus: string) {
  return ["PAGO", "REVISAO"].includes(paymentStatus) ? "CANCELAMENTO_PENDENTE" : "CANCELADO";
}
