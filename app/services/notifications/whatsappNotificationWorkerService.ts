import crypto from "crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { WApiClient, wApiMessageIdFromResponse, wApiSendAccepted } from "../whatsapp/wApiClient";
import { prisma } from "../../utils/prisma";
import { normalizeWhatsAppNotificationPhone } from "./whatsappNotificationPolicy";
import { notifyAdminsWhatsAppUnavailable } from "./whatsappAvailabilityAlertService";
import type { WhatsAppQueueJobData } from "./whatsappNotificationQueueService";

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function errorMessage(error: any) {
  const value = error?.response?.data?.message || error?.response?.data || error?.message || error;
  return String(typeof value === "string" ? value : safeJson(value)).slice(0, 60_000);
}

async function markRestaurantOrderEventSent(
  notification: { id: number; contaId: number; pedidoId: number; evento: string },
  externalMessageId: string,
  response: unknown,
) {
  await prisma.$transaction(async (tx) => {
    await tx.restauranteWhatsAppNotificacao.update({
      where: { id: notification.id },
      data: {
        status: "ENVIADA",
        externalMessageId,
        respostaApiJson: safeJson(response),
        enviadaEm: new Date(),
        ultimoErro: null,
      },
    });
    const order = await tx.restaurantePedido.findFirst({
      where: { id: notification.pedidoId, contaId: notification.contaId },
      select: { whatsappNotificacoesJson: true },
    });
    if (!order) return;
    const sentEvents = Array.isArray(order.whatsappNotificacoesJson)
      ? order.whatsappNotificacoesJson.filter((item): item is string => typeof item === "string")
      : [];
    if (!sentEvents.includes(notification.evento)) {
      await tx.restaurantePedido.update({
        where: { id: notification.pedidoId },
        data: { whatsappNotificacoesJson: [...sentEvents, notification.evento] },
      });
    }
  });
}

async function handleRestaurantOutboxNotification(notificationId: number) {
  const notification = await prisma.restauranteWhatsAppNotificacao.findUnique({ where: { id: notificationId } });
  if (!notification) return { skipped: true, reason: "restaurant-notification-not-found" };
  if (["ENVIADA", "ENTREGUE", "LIDA"].includes(notification.status)) {
    return { skipped: true, reason: "restaurant-notification-already-sent" };
  }

  const phone = normalizeWhatsAppNotificationPhone(notification.telefone);
  if (!phone) {
    await prisma.restauranteWhatsAppNotificacao.update({
      where: { id: notification.id },
      data: { status: "FALHOU", ultimoErro: "Telefone inválido." },
    });
    return { skipped: true, reason: "invalid-phone" };
  }

  await prisma.restauranteWhatsAppNotificacao.update({
    where: { id: notification.id },
    data: { tentativas: { increment: 1 }, ultimaTentativaEm: new Date(), ultimoErro: null },
  });

  try {
    const instance = await prisma.whatsAppInstancia.findFirst({
      where: {
        id: notification.instanciaId,
        contaId: notification.contaId,
        ativo: true,
        status: WhatsAppInstanciaStatus.CONECTADA,
      },
      select: { instanceId: true, token: true },
    });
    if (!instance) {
      await notifyAdminsWhatsAppUnavailable(
        notification.contaId,
        "a instância está desconectada ou inativa; as mensagens do restaurante continuam na fila",
      );
      throw new Error("Instância de WhatsApp indisponível para a notificação do restaurante.");
    }

    const response = await new WApiClient(instance.instanceId, instance.token).send("text", {
      phone,
      message: notification.mensagem,
      // O mesmo identificador é reutilizado em cada tentativa para manter o rastreio da solicitação.
      messageId: notification.bullJobId,
    });
    if (!wApiSendAccepted(response)) {
      throw new Error(`A W-API recusou o envio: ${safeJson(response)}`);
    }

    const externalMessageId = wApiMessageIdFromResponse(response) || notification.bullJobId;
    await markRestaurantOrderEventSent(notification, externalMessageId, response);
    return { skipped: false, messageId: externalMessageId, notificationId: notification.id };
  } catch (error: any) {
    const message = errorMessage(error);
    await prisma.restauranteWhatsAppNotificacao.update({
      where: { id: notification.id },
      data: { status: "PENDENTE", ultimoErro: message },
    });
    console.warn(
      `[restaurante-whatsapp] Falha no envio da notificação ${notification.id}; o BullMQ tentará novamente.`,
      message,
    );
    throw error;
  }
}

export async function handleWhatsAppNotificationJob(data: WhatsAppQueueJobData) {
  if (data.kind === "RESTAURANT_MESSAGE" && data.notificationId) {
    return handleRestaurantOutboxNotification(data.notificationId);
  }
  const isClientMessage = data.kind === "CLIENT_MESSAGE";
  const isReservationMessage = data.kind === "RESERVATION_MESSAGE";
  const isRestaurantMessage = data.kind === "RESTAURANT_MESSAGE";
  const eventLabel = isClientMessage
    ? "CLIENT_MESSAGE"
    : isReservationMessage
      ? "RESERVATION_MESSAGE"
      : isRestaurantMessage
        ? "RESTAURANT_MESSAGE"
        : data.event;
  const phone = normalizeWhatsAppNotificationPhone(data.phone);
  if (!phone) {
    if (isReservationMessage && data.notificationId) {
      await prisma.reservaNotificacao.updateMany({
        where: { id: data.notificationId, contaId: data.contaId },
        data: { status: "FALHOU", erro: "Telefone inválido." },
      });
    }
    return { skipped: true, reason: "invalid-phone" };
  }

  const instance = await prisma.whatsAppInstancia.findFirst({
    where: {
      id: data.instanceId,
      contaId: data.contaId,
      ativo: true,
      status: WhatsAppInstanciaStatus.CONECTADA,
    },
    select: {
      instanceId: true,
      token: true,
    },
  });

  if (!instance) {
    console.warn(
      `[whatsapp-notifications] Instancia ${data.instanceId} indisponivel para conta ${data.contaId} (evento ${eventLabel})`,
    );
    await notifyAdminsWhatsAppUnavailable(
      data.contaId,
      "a instância está desconectada ou inativa",
    );
    if (isReservationMessage && data.notificationId) {
      await prisma.reservaNotificacao.updateMany({
        where: { id: data.notificationId, contaId: data.contaId },
        data: { status: "FALHOU", erro: "Instância de WhatsApp indisponível." },
      });
    }
    return { skipped: true, reason: "instance-unavailable" };
  }

  const recipientId = isClientMessage
    ? `cliente-${data.clienteId}`
    : isReservationMessage
      ? `reserva-${data.reservaId}`
      : isRestaurantMessage
        ? `pedido-${data.pedidoId}`
        : `usuario-${data.userId}`;
  const messageId = `erp-wa-notif-${data.contaId}-${recipientId}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;

  try {
    await new WApiClient(instance.instanceId, instance.token).send("text", {
      phone,
      message: data.message,
      messageId,
    });
    if (isReservationMessage && data.notificationId) {
      await prisma.reservaNotificacao.updateMany({
        where: { id: data.notificationId, contaId: data.contaId },
        data: { status: "ENVIADA", enviadaEm: new Date(), erro: null },
      });
    }
  } catch (error: any) {
    console.warn(
      `[whatsapp-notifications] Falha ao enviar mensagem (conta ${data.contaId}, evento ${eventLabel})`,
      error?.response?.data || error?.message || error,
    );
    await notifyAdminsWhatsAppUnavailable(
      data.contaId,
      "erro ao enviar mensagem pela instância conectada",
    );
    if (isReservationMessage && data.notificationId) {
      await prisma.reservaNotificacao.updateMany({
        where: { id: data.notificationId, contaId: data.contaId },
        data: {
          status: "FALHOU",
          erro: String(error?.response?.data?.message || error?.message || error),
        },
      });
    }
    // Relanca o erro para o BullMQ aplicar as tentativas com backoff.
    throw error;
  }

  return { skipped: false, messageId };
}
