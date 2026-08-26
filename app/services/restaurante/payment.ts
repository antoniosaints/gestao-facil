import type { RestaurantePedido } from "../../../generated";
import qrcode from "qrcode";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { getTenantMercadoPagoService } from "../financeiro/tenantMercadoPagoService";
import {
  buildMercadoPagoChargeReference,
  buildMercadoPagoOperationalWebhookUrl,
} from "../financeiro/mercadoPagoChargeReference";
import { dispatchOrderToProduction } from "./production";
import { debitRestaurantOrderStock, RestauranteEstoqueError, returnRestaurantOrderStock } from "./inventory";
import { CommerceError } from "../loja/commerceError";

export type RestauranteOnlinePaymentMethod = "PIX";
const RESTAURANT_PIX_EXPIRATION_MS = 30 * 60 * 1000;

export class RestaurantPaymentCancellationError extends Error {
  constructor(public code: "payment_already_paid" | "payment_cancellation_failed", message: string) {
    super(message);
  }
}

function trackingUrl(slug: string, trackingToken: string) {
  const url = new URL(`/restaurante/${slug}`, env.BASE_URL_FRONTEND);
  url.searchParams.set("pedido", trackingToken);
  return url.toString();
}

export async function restaurantPaymentAction(charge: {
  externalLink: string | null;
  pixCopiaCola: string | null;
  qrCodeDataUrl?: string | null;
  dataVencimento?: Date | null;
}) {
  if (charge.pixCopiaCola) {
    return {
      type: "PIX" as const,
      url: charge.externalLink,
      pixCopiaCola: charge.pixCopiaCola,
      qrCodeDataUrl: charge.qrCodeDataUrl || await qrcode.toDataURL(charge.pixCopiaCola, { errorCorrectionLevel: "M", margin: 1, width: 280 }),
      expiresAt: charge.dataVencimento?.toISOString() || null,
    };
  }
  return { type: "REDIRECT" as const, url: charge.externalLink };
}

export async function createRestaurantOnlinePayment(args: {
  order: RestaurantePedido;
  method: RestauranteOnlinePaymentMethod;
  slug: string;
  trackingToken: string;
  idempotencyKey: string;
}) {
  const existing = await prisma.cobrancasFinanceiras.findUnique({
    where: { restaurantePedidoId: args.order.id },
  });
  if (existing) return restaurantPaymentAction(existing);

  const mp = await getTenantMercadoPagoService(args.order.contaId);
  const uid = gerarIdUnicoComMetaFinal("COB");
  const kind = "pix" as const;
  const reference = {
    contaId: args.order.contaId,
    chargeUid: uid,
    kind,
    origin: { type: "restaurante-pedido" as const, id: args.order.id },
  };
  const returnUrl = trackingUrl(args.slug, args.trackingToken);
  // O QR Code do cardápio permanece válido por tempo suficiente para o cliente
  // concluir a transferência, sem deixar uma cobrança pendente por horas.
  const pixExpiresAt = new Date(Date.now() + RESTAURANT_PIX_EXPIRATION_MS);
  let gatewayReference: string;
  let externalLink: string | null;
  let pixCopiaCola: string | null = null;
  let qrCodeDataUrl: string | null = null;

  const payment = await mp.payment.create({
    requestOptions: { idempotencyKey: `restaurante:${args.order.contaId}:${args.idempotencyKey}` },
    body: {
      payer: {
        email: args.order.clienteEmail || "cliente@restaurante.gestaofacil.app",
        entity_type: "individual",
      },
      external_reference: buildMercadoPagoChargeReference(reference),
      transaction_amount: Number(args.order.total),
      description: `Pedido ${args.order.codigo}`.slice(0, 120),
      payment_method_id: "pix",
      installments: 1,
      date_of_expiration: pixExpiresAt.toISOString(),
      callback_url: returnUrl,
      notification_url: buildMercadoPagoOperationalWebhookUrl(env.BASE_URL, reference),
    },
  });
  gatewayReference = String(payment.id || uid);
  externalLink = payment.point_of_interaction?.transaction_data?.ticket_url || null;
  pixCopiaCola = payment.point_of_interaction?.transaction_data?.qr_code || null;
  const qrCodeBase64 = payment.point_of_interaction?.transaction_data?.qr_code_base64 || null;
  if (qrCodeBase64) qrCodeDataUrl = qrCodeBase64.startsWith("data:image/") ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`;
  // Para o atendimento, link sozinho não é uma confirmação de Pix suficiente:
  // o cliente deve receber o código copia-e-cola e o QR Code. Compensa a cobrança
  // remota caso o gateway responda incompleto, evitando Pix órfão.
  if (!pixCopiaCola) {
    await mp.payment.cancel({ id: gatewayReference }).catch(() => undefined);
    throw new Error("O Mercado Pago não retornou o código Pix copia e cola.");
  }

  try {
    const charge = await prisma.cobrancasFinanceiras.create({
      data: {
        contaId: args.order.contaId,
        restaurantePedidoId: args.order.id,
        idCobranca: gatewayReference,
        Uid: uid,
        externalLink,
        pixCopiaCola,
        valor: args.order.total,
        gateway: "mercadopago",
        dataVencimento: payment.date_of_expiration
          ? new Date(payment.date_of_expiration)
          : pixExpiresAt,
        status: "PENDENTE",
        observacao: `Pedido restaurante ${args.order.codigo}`,
      },
    });
    return restaurantPaymentAction({ ...charge, qrCodeDataUrl });
  } catch (error: any) {
    if (error?.code !== "P2002") {
      // A cobrança foi aceita pelo gateway, mas não pôde ser persistida localmente.
      // Compensamos antes de propagar o erro para que não reste Pix sem pedido.
      await mp.payment.cancel({ id: gatewayReference }).catch(() => undefined);
      throw error;
    }
    const winner = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
      where: { restaurantePedidoId: args.order.id },
    });
    return restaurantPaymentAction(winner);
  }
}

/** Cancela no gateway antes de permitir que o pedido PIX pendente seja cancelado localmente. */
export async function cancelRestaurantPendingPixPayment(args: { contaId: number; orderId: number }) {
  const charge = await prisma.cobrancasFinanceiras.findFirst({
    where: {
      contaId: args.contaId,
      restaurantePedidoId: args.orderId,
      gateway: "mercadopago",
      status: "PENDENTE",
      pixCopiaCola: { not: null },
    },
    select: { id: true, idCobranca: true },
  });
  if (!charge) return null;

  const mp = await getTenantMercadoPagoService(args.contaId);
  const payment = await mp.payment.get({ id: charge.idCobranca });
  if (["approved", "authorized"].includes(String(payment.status))) {
    throw new RestaurantPaymentCancellationError("payment_already_paid", "O Pix deste pedido ja foi aprovado. Atualize o pedido antes de cancelar.");
  }
  if (!["cancelled", "refunded"].includes(String(payment.status))) {
    const cancelled = await mp.payment.cancel({ id: charge.idCobranca });
    if (cancelled.status !== "cancelled") {
      throw new RestaurantPaymentCancellationError("payment_cancellation_failed", "O Mercado Pago nao confirmou o cancelamento do Pix.");
    }
  }
  return charge.id;
}

export async function applyRestaurantPaymentEvent(input: {
  contaId: number;
  orderId: number;
  status: "PENDENTE" | "EFETIVADO" | "CANCELADO" | "ESTORNADO";
}) {
  const order = await prisma.restaurantePedido.findFirst({ where: { id: input.orderId, contaId: input.contaId } });
  if (!order) return null;
  if (input.status === "CANCELADO" && order.status === "CANCELADO") return order;
  if (input.status === "EFETIVADO") {
    try {
      return await prisma.$transaction(async (tx) => {
        if (order.status === "RECEBIDO") await debitRestaurantOrderStock(tx, input.contaId, order.id);
        const updated = await tx.restaurantePedido.update({
          where: { id: order.id },
          data: {
            pagamentoStatus: "PAGO",
            ...(order.status === "RECEBIDO" ? { status: "CONFIRMADO" } : {}),
            version: { increment: 1 },
          },
        });
        if (order.status === "RECEBIDO") await dispatchOrderToProduction(tx, input.contaId, order.id);
        return updated;
      });
    } catch (error) {
      if (!(error instanceof CommerceError) && !(error instanceof RestauranteEstoqueError)) throw error;
      return prisma.restaurantePedido.update({
        where: { id: order.id },
        data: { pagamentoStatus: "EM_REVISAO", version: { increment: 1 } },
      });
    }
  }
  if (input.status === "ESTORNADO") {
    return prisma.$transaction(async (tx) => {
      await returnRestaurantOrderStock(tx, input.contaId, order.id);
      return tx.restaurantePedido.update({
        where: { id: order.id },
        data: {
          pagamentoStatus: "ESTORNADO",
          ...(order.status !== "CONCLUIDO" ? { status: "CANCELADO", canceladoAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
    });
  }
  if (input.status === "CANCELADO") {
    return prisma.restaurantePedido.update({
      where: { id: order.id },
      data: { pagamentoStatus: "FALHOU", version: { increment: 1 } },
    });
  }
  return order;
}
