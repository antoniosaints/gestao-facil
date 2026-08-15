import crypto from "node:crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { whatsappNotificationQueue } from "../../queues/whatsappNotificationQueue";
import { normalizeClienteWhatsappPhone } from "../clientes/clienteWhatsappPolicy";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { prisma } from "../../utils/prisma";
import type { WhatsAppRestaurantMessageJobData } from "../notifications/whatsappNotificationQueueService";
import { buildRestaurantWhatsAppTemplateValues, renderRestaurantWhatsAppTemplate } from "./whatsappNotificationTemplate";

export const RESTAURANT_WHATSAPP_EVENTS = [
  "PEDIDO_FEITO",
  "EM_PREPARO",
  "SAIU_ENTREGA",
  "PRONTO",
  "ENTREGUE",
  "FIDELIDADE",
  "POS_PEDIDO",
] as const;

export type RestaurantWhatsAppEvent = (typeof RESTAURANT_WHATSAPP_EVENTS)[number];
export type RestaurantWhatsAppSettings = Record<RestaurantWhatsAppEvent, { ativo: boolean; mensagem: string }>;

const DEFAULT_MESSAGES: Record<RestaurantWhatsAppEvent, string> = {
  PEDIDO_FEITO: "Pedido nº {idPedido}\n\nItens:\n{itens}\n\n{pagamento}\n\n{entrega}\n🏠 {endereco}\n\nTotal: {total}\n\nObrigado pela preferência, se precisar de algo é só chamar! 😉",
  EM_PREPARO: "Olá, {cliente}! Seu pedido {pedido} já está em preparo.",
  SAIU_ENTREGA: "Olá, {cliente}! Seu pedido {pedido} saiu para entrega.",
  PRONTO: "Olá, {cliente}! Seu pedido {pedido} está pronto.",
  ENTREGUE: "Olá, {cliente}! Seu pedido {pedido} foi entregue. Bom apetite!",
  FIDELIDADE: "Olá, {cliente}! Sua fidelidade foi atualizada: {fidelidade}",
  POS_PEDIDO: "Olá, {cliente}! Obrigado por pedir na {empresa}. Esperamos que tenha gostado!",
};

export function defaultRestaurantWhatsAppSettings(): RestaurantWhatsAppSettings {
  return Object.fromEntries(
    RESTAURANT_WHATSAPP_EVENTS.map((event) => [event, { ativo: false, mensagem: DEFAULT_MESSAGES[event] }]),
  ) as RestaurantWhatsAppSettings;
}

export function normalizeRestaurantWhatsAppSettings(value: unknown): RestaurantWhatsAppSettings {
  const defaults = defaultRestaurantWhatsAppSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  for (const event of RESTAURANT_WHATSAPP_EVENTS) {
    const current = (value as Record<string, any>)[event];
    if (!current || typeof current !== "object") continue;
    defaults[event] = {
      ativo: Boolean(current.ativo),
      mensagem: typeof current.mensagem === "string" && current.mensagem.trim()
        ? current.mensagem.trim()
        : defaults[event].mensagem,
    };
  }
  return defaults;
}

export async function enqueueRestaurantOrderWhatsApp(orderId: number, event: RestaurantWhatsAppEvent) {
  try {
    const order = await prisma.restaurantePedido.findUnique({
      where: { id: orderId },
      include: {
        Conta: { select: { nome: true, nomeFantasia: true } },
        itens: { orderBy: { id: "asc" } },
        Cobrancas: { orderBy: { dataCadastro: "desc" }, take: 1, select: { externalLink: true } },
        // A configuração é isolada por conta e nunca é exposta ao cardápio público.
      },
    });
    if (!order?.clienteTelefone) return false;

    const config = await prisma.restauranteConfig.findUnique({
      where: { contaId: order.contaId },
      select: { whatsappNotificacoesJson: true },
    });
    const settings = normalizeRestaurantWhatsAppSettings(config?.whatsappNotificacoesJson);
    const definition = settings[event];
    const alreadyQueued = Array.isArray(order.whatsappNotificacoesJson)
      ? order.whatsappNotificacoesJson.filter((item): item is string => typeof item === "string")
      : [];
    if (!definition.ativo || alreadyQueued.includes(event)) return false;

    const phone = normalizeClienteWhatsappPhone(order.clienteTelefone);
    if (!phone || !(await contaHasActiveModule(order.contaId, "whatsapp"))) return false;

    const parameters = await prisma.parametrosConta.findUnique({
      where: { contaId: order.contaId },
      select: { whatsappNotificacoesInstanciaId: true },
    });
    if (!parameters?.whatsappNotificacoesInstanciaId) return false;
    const instance = await prisma.whatsAppInstancia.findFirst({
      where: {
        id: parameters.whatsappNotificacoesInstanciaId,
        contaId: order.contaId,
        ativo: true,
        status: WhatsAppInstanciaStatus.CONECTADA,
      },
      select: { id: true },
    });
    if (!instance) return false;

    let fidelityMessage = "";
    if (event === "FIDELIDADE") {
      const program = await prisma.restauranteFidelidadePrograma.findUnique({ where: { contaId: order.contaId } });
      const progress = program ? await prisma.restauranteFidelidadeProgresso.findUnique({
        where: { contaId_telefoneNormalizado: { contaId: order.contaId, telefoneNormalizado: phone } },
      }) : null;
      if (program && progress) fidelityMessage = progress.recompensasDisponiveis > 0
        ? `você tem ${progress.recompensasDisponiveis} recompensa(s) disponível(is)!`
        : `${progress.pedidosElegiveis % program.pedidosMeta}/${program.pedidosMeta} pedidos para a próxima recompensa.`;
    }
    const paymentUrl = order.Cobrancas[0]?.externalLink || null;
    let message = renderRestaurantWhatsAppTemplate(definition.mensagem, buildRestaurantWhatsAppTemplateValues({
      ...order,
      empresa: order.Conta.nomeFantasia || order.Conta.nome,
      fidelidade: fidelityMessage,
      urlPagamento: paymentUrl,
    }));
    if (event === "PEDIDO_FEITO" && paymentUrl && order.pagamentoMetodoSnapshot !== "NA_ENTREGA" && !message.includes(paymentUrl)) {
      message = `${message.trim()}\n\nPague seu pedido aqui: ${paymentUrl}`;
    }
    if (!message.trim()) return false;

    await whatsappNotificationQueue.add(
      "send-restaurant-message",
      {
        kind: "RESTAURANT_MESSAGE",
        contaId: order.contaId,
        instanceId: instance.id,
        pedidoId: order.id,
        phone,
        message,
      } satisfies WhatsAppRestaurantMessageJobData,
      {
        jobId: `wa-restaurant-${order.contaId}-${order.id}-${event}-${crypto.randomUUID()}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    await prisma.restaurantePedido.update({
      where: { id: order.id },
      data: { whatsappNotificacoesJson: [...alreadyQueued, event] },
    });
    return true;
  } catch (error) {
    console.warn(`[restaurante-whatsapp] Falha ao enfileirar ${event} do pedido ${orderId}`, error);
    return false;
  }
}
