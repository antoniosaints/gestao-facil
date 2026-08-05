import { randomUUID } from "node:crypto";
import type { RestaurantePedido } from "../../../generated";
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

export type RestauranteOnlinePaymentMethod = "PIX" | "CHECKOUT_PRO";

function trackingUrl(slug: string, trackingToken: string) {
  const url = new URL(`/restaurante/${slug}`, env.BASE_URL_FRONTEND);
  url.searchParams.set("pedido", trackingToken);
  return url.toString();
}

function existingPaymentAction(charge: { externalLink: string | null; pixCopiaCola: string | null }) {
  if (charge.pixCopiaCola) {
    return { type: "PIX" as const, url: charge.externalLink, pixCopiaCola: charge.pixCopiaCola };
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
  if (existing) return existingPaymentAction(existing);

  const mp = await getTenantMercadoPagoService(args.order.contaId);
  const uid = gerarIdUnicoComMetaFinal("COB");
  const kind = args.method === "PIX" ? "pix" as const : "link" as const;
  const reference = {
    contaId: args.order.contaId,
    chargeUid: uid,
    kind,
    origin: { type: "restaurante-pedido" as const, id: args.order.id },
  };
  const returnUrl = trackingUrl(args.slug, args.trackingToken);
  let gatewayReference: string;
  let externalLink: string | null;
  let pixCopiaCola: string | null = null;

  if (args.method === "PIX") {
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
        callback_url: returnUrl,
        notification_url: buildMercadoPagoOperationalWebhookUrl(env.BASE_URL, reference),
      },
    });
    gatewayReference = String(payment.id || uid);
    externalLink = payment.point_of_interaction?.transaction_data?.ticket_url || null;
    pixCopiaCola = payment.point_of_interaction?.transaction_data?.qr_code || null;
    if (!pixCopiaCola && !externalLink) throw new Error("O Mercado Pago nao retornou os dados do Pix.");
  } else {
    const preference = await mp.preference.create({
      requestOptions: { idempotencyKey: `restaurante:${args.order.contaId}:${args.idempotencyKey}` },
      body: {
        items: [{ id: randomUUID(), title: `Pedido ${args.order.codigo}`, quantity: 1, unit_price: Number(args.order.total) }],
        payer: { email: args.order.clienteEmail || "cliente@restaurante.gestaofacil.app" },
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        notification_url: buildMercadoPagoOperationalWebhookUrl(env.BASE_URL, reference),
        external_reference: buildMercadoPagoChargeReference(reference),
        auto_return: "approved",
      },
    });
    gatewayReference = String(preference.id || uid);
    externalLink = preference.init_point || null;
    if (!externalLink) throw new Error("O Mercado Pago nao retornou o link do Checkout Pro.");
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
        dataVencimento: new Date(Date.now() + 30 * 60 * 1000),
        status: "PENDENTE",
        observacao: `Pedido restaurante ${args.order.codigo}`,
      },
    });
    return existingPaymentAction(charge);
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const winner = await prisma.cobrancasFinanceiras.findUniqueOrThrow({
      where: { restaurantePedidoId: args.order.id },
    });
    return existingPaymentAction(winner);
  }
}

export async function applyRestaurantPaymentEvent(input: {
  contaId: number;
  orderId: number;
  status: "PENDENTE" | "EFETIVADO" | "CANCELADO" | "ESTORNADO";
}) {
  const order = await prisma.restaurantePedido.findFirst({ where: { id: input.orderId, contaId: input.contaId } });
  if (!order) return null;
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
