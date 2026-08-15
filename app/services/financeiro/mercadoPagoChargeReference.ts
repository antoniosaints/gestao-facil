export type OperationalChargeOriginType =
  | "parcela"
  | "venda"
  | "os"
  | "reserva"
  | "reserva-geral"
  | "restaurante-pedido";
export type MercadoPagoChargeKind = "pix" | "boleto" | "link";

export interface MercadoPagoChargeReference {
  contaId: number;
  chargeUid: string;
  kind: MercadoPagoChargeKind;
  origin?: {
    type: OperationalChargeOriginType;
    id: number;
  };
}

const ORIGIN_TYPES = new Set<OperationalChargeOriginType>([
  "parcela",
  "venda",
  "os",
  "reserva",
  "reserva-geral",
  "restaurante-pedido",
]);

export function buildMercadoPagoChargeReference(
  reference: MercadoPagoChargeReference,
): string {
  const parts = [
    `conta:${reference.contaId}`,
    `cobranca:${reference.chargeUid}`,
    `tipo:${reference.kind}`,
  ];

  if (reference.origin) {
    parts.push(`origem:${reference.origin.type}`, `entidade:${reference.origin.id}`);
  }

  return parts.join("|");
}

export function parseMercadoPagoChargeReference(
  value?: string | null,
): MercadoPagoChargeReference | null {
  if (!value) return null;

  const fields = new Map<string, string>();
  let legacyKind: string | undefined;

  for (const part of value.split("|")) {
    const separator = part.indexOf(":");
    if (separator === -1) {
      legacyKind = part.toLowerCase();
      continue;
    }

    fields.set(part.slice(0, separator).toLowerCase(), part.slice(separator + 1));
  }

  const contaId = Number(fields.get("conta"));
  const chargeUid = fields.get("cobranca");
  const kind = (fields.get("tipo") || legacyKind) as MercadoPagoChargeKind | undefined;

  if (
    !Number.isInteger(contaId) ||
    contaId <= 0 ||
    !chargeUid ||
    !kind ||
    !["pix", "boleto", "link"].includes(kind)
  ) {
    return null;
  }

  const originType = fields.get("origem") as OperationalChargeOriginType | undefined;
  const originId = Number(fields.get("entidade"));

  if (originType || fields.has("entidade")) {
    if (
      !originType ||
      !ORIGIN_TYPES.has(originType) ||
      !Number.isInteger(originId) ||
      originId <= 0
    ) {
      return null;
    }

    return {
      contaId,
      chargeUid,
      kind,
      origin: { type: originType, id: originId },
    };
  }

  return { contaId, chargeUid, kind };
}

export function buildMercadoPagoOperationalWebhookUrl(
  baseUrl: string,
  reference: MercadoPagoChargeReference,
): string {
  const url = new URL("/mercadopago/webhook/cobrancas", baseUrl);
  url.searchParams.set("contaId", String(reference.contaId));
  url.searchParams.set("escopo", "operacional");
  url.searchParams.set("tipo", reference.kind);
  url.searchParams.set("cobrancaUid", reference.chargeUid);

  if (reference.origin) {
    url.searchParams.set("origemTipo", reference.origin.type);
    url.searchParams.set("origemId", String(reference.origin.id));
  }

  return url.toString();
}

export function buildMercadoPagoLinkChargeData(
  paymentId: number,
  payment: {
    transaction_amount?: number | null;
    date_of_expiration?: string | null;
    payment_type_id?: string | null;
    transaction_details?: { external_resource_url?: string | null } | null;
    point_of_interaction?: {
      transaction_data?: { ticket_url?: string | null } | null;
    } | null;
  },
  reference: MercadoPagoChargeReference,
) {
  if (reference.kind !== "link") {
    throw new Error("A referência informada não pertence a um link de pagamento.");
  }

  const externalLink =
    payment.payment_type_id === "ticket"
      ? payment.transaction_details?.external_resource_url || null
      : payment.point_of_interaction?.transaction_data?.ticket_url || null;

  return {
    contaId: reference.contaId,
    gateway: "mercadopago",
    valor: Number(payment.transaction_amount || 0),
    idCobranca: String(paymentId),
    Uid: reference.chargeUid,
    externalLink,
    dataVencimento: payment.date_of_expiration
      ? new Date(payment.date_of_expiration)
      : new Date(),
    status: "PENDENTE" as const,
    observacao:
      "Cobrança por link criada pelo webhook do Mercado Pago - Gestão Fácil - ERP",
    vendaId: reference.origin?.type === "venda" ? reference.origin.id : null,
    lancamentoId:
      reference.origin?.type === "parcela" ? reference.origin.id : null,
    ordemServicoId: reference.origin?.type === "os" ? reference.origin.id : null,
    reservaId: reference.origin?.type === "reserva" ? reference.origin.id : null,
    reservaGeralId:
      reference.origin?.type === "reserva-geral" ? reference.origin.id : null,
    restaurantePedidoId:
      reference.origin?.type === "restaurante-pedido" ? reference.origin.id : null,
  };
}
