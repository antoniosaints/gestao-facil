export type WhatsAppInstanceRemovalStatus =
  | "PENDENTE"
  | "CONECTADA"
  | "DESCONECTADA"
  | "CONECTANDO"
  | "ERRO";

export type WhatsAppInstanceStatus = WhatsAppInstanceRemovalStatus;

export type WhatsAppPaymentStatus =
  | "PENDENTE"
  | "PAGO"
  | "FALHOU"
  | "CANCELADO";

export function canRemoveWhatsAppInstance(instance: {
  status: WhatsAppInstanceRemovalStatus;
}) {
  return Boolean(instance.status);
}

export function canDeleteWhatsAppPayment(payment: {
  status: WhatsAppPaymentStatus;
}) {
  return payment.status === "PENDENTE";
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

export function mapWApiInstanceStatusFromPayload(payload: any): WhatsAppInstanceStatus {
  const connected =
    payload?.connected ??
    payload?.result?.connected ??
    payload?.data?.connected ??
    payload?.instance?.connected ??
    payload?.connection?.connected;

  if (typeof connected === "boolean") {
    return connected ? "CONECTADA" : "DESCONECTADA";
  }

  const status = String(
    payload?.status ||
      payload?.state ||
      payload?.connection ||
      payload?.result?.status ||
      payload?.result?.state ||
      payload?.data?.status ||
      payload?.data?.state ||
      ""
  ).toLowerCase();

  if (["open", "connected", "conectado", "online", "success"].some((term) => status.includes(term))) {
    return "CONECTADA";
  }

  if (["connecting", "qrcode", "pairing", "loading"].some((term) => status.includes(term))) {
    return "CONECTANDO";
  }

  if (["close", "closed", "disconnected", "desconectado", "offline"].some((term) => status.includes(term))) {
    return "DESCONECTADA";
  }

  if (["error", "erro", "failed"].some((term) => status.includes(term))) {
    return "ERRO";
  }

  return "PENDENTE";
}

export interface WApiFetchInstanceInfo {
  status: WhatsAppInstanceStatus;
  connectedPhone: string | null;
  // Data de vencimento da assinatura da instância (transiente — não persistida no banco).
  expiresAt: Date | null;
  // Situação de pagamento reportada pela W-API, normalizada em maiúsculas (ex.: "PAID").
  assinaturaStatus: string | null;
}

// Interpreta o retorno de `GET /v1/instance/fetch-instance` da W-API. Diferente de `status-instance`,
// este payload traz `expires` (epoch em ms) e `paymentStatus`, usados para orientar o usuário sobre
// vencimento e necessidade de pagamento. Reaproveita o mapeamento de status (que já lê `connected`).
export function mapWApiFetchInstancePayload(payload: any): WApiFetchInstanceInfo {
  const rawExpires = payload?.expires ?? payload?.data?.expires;
  const expiresMs = Number(rawExpires);
  const expiresAt =
    Number.isFinite(expiresMs) && expiresMs > 0 ? new Date(expiresMs) : null;

  const connectedPhone = String(
    payload?.connectedPhone ?? payload?.data?.connectedPhone ?? ""
  ).trim() || null;

  const assinaturaStatus = String(
    payload?.paymentStatus ?? payload?.data?.paymentStatus ?? ""
  ).trim().toUpperCase() || null;

  return {
    status: mapWApiInstanceStatusFromPayload(payload),
    connectedPhone,
    expiresAt,
    assinaturaStatus,
  };
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
