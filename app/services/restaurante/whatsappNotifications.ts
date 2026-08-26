import crypto from "node:crypto";
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

// A outbox continua tentando enquanto a instância ou a W-API estiverem indisponíveis.
// O backoff fixo evita que uma indisponibilidade longa transforme as tentativas em meses.
export const RESTAURANT_WHATSAPP_RETRY_ATTEMPTS = 1_000_000;
export const RESTAURANT_WHATSAPP_RETRY_DELAY_MS = 30_000;

function restaurantNotificationJobOptions(jobId: string) {
  return {
    jobId,
    attempts: RESTAURANT_WHATSAPP_RETRY_ATTEMPTS,
    backoff: { type: "fixed" as const, delay: RESTAURANT_WHATSAPP_RETRY_DELAY_MS },
    removeOnComplete: true,
    // Preserva a evidência de uma falha terminal inesperada para inspeção operacional.
    removeOnFail: false,
  };
}

function restaurantNotificationJobData(notification: {
  id: number;
  contaId: number;
  instanciaId: number;
  pedidoId: number;
  telefone: string;
  mensagem: string;
}) {
  return {
    kind: "RESTAURANT_MESSAGE" as const,
    notificationId: notification.id,
    contaId: notification.contaId,
    instanceId: notification.instanciaId,
    pedidoId: notification.pedidoId,
    phone: notification.telefone,
    message: notification.mensagem,
  } satisfies WhatsAppRestaurantMessageJobData;
}

async function addRestaurantNotificationJob(notification: {
  id: number;
  bullJobId: string;
  contaId: number;
  instanciaId: number;
  pedidoId: number;
  telefone: string;
  mensagem: string;
}) {
  await whatsappNotificationQueue.add(
    "send-restaurant-message",
    restaurantNotificationJobData(notification),
    restaurantNotificationJobOptions(notification.bullJobId),
  );
}

/** Recupera registros gravados antes de uma queda entre o banco e o Redis. */
export async function requeuePendingRestaurantWhatsAppNotifications(limit = 100) {
  const pending = await prisma.restauranteWhatsAppNotificacao.findMany({
    where: { status: "PENDENTE" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      bullJobId: true,
      contaId: true,
      instanciaId: true,
      pedidoId: true,
      telefone: true,
      mensagem: true,
    },
  });
  const results = await Promise.allSettled(pending.map(addRestaurantNotificationJob));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) {
    console.warn(`[restaurante-whatsapp] ${failures} notificação(ões) pendentes não puderam ser reenfileiradas.`);
  }
  return { recovered: pending.length - failures, failures };
}

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
      select: { whatsappNotificacoesJson: true, whatsappNotificacoesInstanciaId: true },
    });
    const settings = normalizeRestaurantWhatsAppSettings(config?.whatsappNotificacoesJson);
    const definition = settings[event];
    if (!definition.ativo) return false;

    const phone = normalizeClienteWhatsappPhone(order.clienteTelefone);
    if (!phone || !(await contaHasActiveModule(order.contaId, "whatsapp"))) return false;

    // A configuração do Restaurante prevalece. O fallback mantém os restaurantes
    // legados operando até que a migração seja aplicada em todos os ambientes.
    const parameters = config?.whatsappNotificacoesInstanciaId ? null : await prisma.parametrosConta.findUnique({
      where: { contaId: order.contaId },
      select: { whatsappNotificacoesInstanciaId: true },
    });
    const instanciaId = config?.whatsappNotificacoesInstanciaId || parameters?.whatsappNotificacoesInstanciaId;
    if (!instanciaId) return false;
    const instance = await prisma.whatsAppInstancia.findFirst({
      where: {
        id: instanciaId,
        contaId: order.contaId,
        ativo: true,
      },
      select: { id: true },
    });
    if (!instance) return false;

    let fidelityMessage = "";
    if (event === "FIDELIDADE") {
      const programs = await prisma.restauranteFidelidadePrograma.findMany({ where: { contaId: order.contaId, ativo: true } });
      const progresses = programs.length ? await prisma.restauranteFidelidadeProgresso.findMany({
        where: { contaId: order.contaId, telefoneNormalizado: phone, programaId: { in: programs.map((program) => program.id) } },
      }) : [];
      const progressByProgram = new Map(progresses.map((progress) => [progress.programaId, progress]));
      const messages = programs.flatMap((program) => {
        const progress = progressByProgram.get(program.id);
        if (!progress) return [];
        return [progress.recompensasDisponiveis > 0
          ? `você tem ${progress.recompensasDisponiveis} recompensa(s) disponível(is)!`
          : `${progress.pedidosElegiveis % program.pedidosMeta}/${program.pedidosMeta} itens para a próxima recompensa.`];
      });
      fidelityMessage = messages.join(" ");
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

    // A chave única pedido/evento torna o disparo idempotente mesmo quando o pedido
    // recebe duas atualizações quase simultâneas. O conteúdo é o snapshot do evento
    // original e não deve ser alterado quando uma notificação pendente é reenfileirada.
    const notification = await prisma.restauranteWhatsAppNotificacao.upsert({
      where: { pedidoId_evento: { pedidoId: order.id, evento: event } },
      update: {},
      create: {
        contaId: order.contaId,
        pedidoId: order.id,
        evento: event,
        instanciaId: instance.id,
        telefone: phone,
        mensagem: message,
        bullJobId: `wa-restaurant-${order.contaId}-${order.id}-${event}-${crypto.randomUUID()}`,
      },
    });
    if (["ENVIADA", "ENTREGUE", "LIDA", "FALHOU"].includes(notification.status)) {
      return false;
    }
    await addRestaurantNotificationJob(notification);
    return true;
  } catch (error) {
    console.warn(`[restaurante-whatsapp] Falha ao enfileirar ${event} do pedido ${orderId}`, error);
    return false;
  }
}
