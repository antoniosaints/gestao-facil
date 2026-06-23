export type WhatsAppInstanceRemovalStatus =
  | "PENDENTE"
  | "CONECTADA"
  | "DESCONECTADA"
  | "CONECTANDO"
  | "ERRO";

export type WhatsAppPaymentStatus =
  | "PENDENTE"
  | "PAGO"
  | "FALHOU"
  | "CANCELADO";

export function canRemoveWhatsAppInstance(instance: {
  status: WhatsAppInstanceRemovalStatus;
}) {
  return instance.status === "DESCONECTADA";
}

export function buildWApiPaymentPayload(
  payerEmail: string,
  webhookPaymentUrl?: string | null
) {
  return {
    payerEmail,
    ...(webhookPaymentUrl ? { webhookPaymentUrl } : {}),
  };
}

export function mapWApiPaymentStatus(payload: any): WhatsAppPaymentStatus {
  const status = String(
    payload?.status ||
      payload?.paymentStatus ||
      payload?.data?.status ||
      payload?.type ||
      ""
  ).toLowerCase();

  if (["approved", "paid", "pago", "success", "succeeded"].some((term) => status.includes(term))) {
    return "PAGO";
  }

  if (["failed", "fail", "erro", "error", "rejected"].some((term) => status.includes(term))) {
    return "FALHOU";
  }

  if (["cancel", "canceled", "cancelled", "cancelado"].some((term) => status.includes(term))) {
    return "CANCELADO";
  }

  return "PENDENTE";
}

export function buildDeletedWhatsAppInstanceId(
  instanceId: string,
  id: number,
  now = new Date()
) {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const safeInstanceId = instanceId.replace(/[^\w.-]+/g, "-");
  return `${safeInstanceId}__deleted_${id}_${timestamp}`;
}
