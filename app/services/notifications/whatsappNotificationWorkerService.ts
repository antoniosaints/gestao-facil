import crypto from "crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { WApiClient } from "../whatsapp/wApiClient";
import { prisma } from "../../utils/prisma";
import { normalizeWhatsAppNotificationPhone } from "./whatsappNotificationPolicy";
import { notifyAdminsWhatsAppUnavailable } from "./whatsappAvailabilityAlertService";
import type { WhatsAppQueueJobData } from "./whatsappNotificationQueueService";

export async function handleWhatsAppNotificationJob(data: WhatsAppQueueJobData) {
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
