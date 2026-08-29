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
import { restoreReservedFidelityRewards } from "./loyalty";
import { CommerceError } from "../loja/commerceError";

export type RestauranteOnlinePaymentMethod = "PIX";
export const RESTAURANT_PIX_EXPIRATION_MS = 5 * 60 * 1000;
export const MERCADO_PAGO_PIX_EXPIRATION_MS = 30 * 60 * 1000;

export function restaurantPixDeadlines(now = new Date()) {
  return {
    customerExpiresAt: new Date(now.getTime() + RESTAURANT_PIX_EXPIRATION_MS),
    gatewayExpiresAt: new Date(now.getTime() + MERCADO_PAGO_PIX_EXPIRATION_MS),
  };
}

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
  // O Mercado Pago exige no mínimo 30 minutos para o vencimento do Pix. Para o
  // cliente, porém, o pedido reserva uma janela de 5 minutos; após esse prazo o
  // worker consulta o gateway e cancela a cobrança se ela ainda estiver pendente.
  const { customerExpiresAt, gatewayExpiresAt } = restaurantPixDeadlines();
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
      date_of_expiration: gatewayExpiresAt.toISOString(),
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
        // Prazo comercial exibido ao cliente e usado pelo worker de expiração.
        // O vencimento técnico enviado ao gateway permanece em 30 minutos.
        dataVencimento: customerExpiresAt,
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

/**
 * Cancela pedidos do cardápio que continuam aguardando o Pix após a validade
 * da cobrança. O gateway é cancelado antes da alteração local para não deixar
 * um QR Code válido para um pedido já cancelado.
 */
export async function expireRestaurantPendingPixOrders(now = new Date()) {
  const candidates = await prisma.restaurantePedido.findMany({
    where: {
      status: "RECEBIDO",
      pagamentoStatus: "PENDENTE",
      pagamentoMetodoSnapshot: "PIX",
      Cobrancas: {
        some: {
          gateway: "mercadopago",
          status: "PENDENTE",
          pixCopiaCola: { not: null },
          dataVencimento: { lte: now },
        },
      },
    },
    select: {
      id: true,
      contaId: true,
      clienteTelefone: true,
      fidelidadeRecompensasJson: true,
    },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  const expired: Array<{ id: number; contaId: number }> = [];
  const paidDuringExpiration: Array<{ id: number; contaId: number }> = [];

  for (const order of candidates) {
    let chargeId: number | null = null;
    try {
      chargeId = await cancelRestaurantPendingPixPayment({
        contaId: order.contaId,
        orderId: order.id,
      });
    } catch (error) {
      if (error instanceof RestaurantPaymentCancellationError && error.code === "payment_already_paid") {
        await applyRestaurantPaymentEvent({
          contaId: order.contaId,
          orderId: order.id,
          status: "EFETIVADO",
        });
        paidDuringExpiration.push({ id: order.id, contaId: order.contaId });
        continue;
      }
      // Se o gateway não confirmar o cancelamento, mantém o pedido aberto para
      // uma nova tentativa no próximo ciclo, evitando divergência de pagamento.
      continue;
    }
    if (!chargeId) continue;

    const cancelled = await prisma.$transaction(async (tx) => {
      const result = await tx.restaurantePedido.updateMany({
        where: {
          id: order.id,
          contaId: order.contaId,
          status: "RECEBIDO",
          pagamentoStatus: "PENDENTE",
          pagamentoMetodoSnapshot: "PIX",
        },
        data: {
          status: "CANCELADO",
          pagamentoStatus: "FALHOU",
          canceladoAt: now,
          version: { increment: 1 },
        },
      });
      if (!result.count) return false;
      await tx.cobrancasFinanceiras.updateMany({
        where: {
          id: chargeId,
          contaId: order.contaId,
          restaurantePedidoId: order.id,
          status: "PENDENTE",
        },
        data: { status: "CANCELADO" },
      });
      await restoreReservedFidelityRewards(
        tx,
        order.contaId,
        order.clienteTelefone,
        order.fidelidadeRecompensasJson,
      );
      return true;
    });
    if (cancelled) expired.push({ id: order.id, contaId: order.contaId });
  }

  return { expired, paidDuringExpiration };
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
            ...(order.status === "RECEBIDO" ? { status: "CONFIRMADO", confirmadoAt: new Date() } : {}),
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
