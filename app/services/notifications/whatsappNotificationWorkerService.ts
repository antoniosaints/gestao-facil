import crypto from "crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { WApiClient } from "../whatsapp/wApiClient";
import { prisma } from "../../utils/prisma";
import { normalizeWhatsAppNotificationPhone } from "./whatsappNotificationPolicy";
import { notifyAdminsWhatsAppUnavailable } from "./whatsappAvailabilityAlertService";
import type { WhatsAppQueueJobData } from "./whatsappNotificationQueueService";

export async function handleWhatsAppNotificationJob(data: WhatsAppQueueJobData) {
  const isClientMessage = data.kind === "CLIENT_MESSAGE";
  const eventLabel = isClientMessage ? "CLIENT_MESSAGE" : data.event;
  const phone = normalizeWhatsAppNotificationPhone(data.phone);
  if (!phone) {
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
    return { skipped: true, reason: "instance-unavailable" };
  }

  const recipientId = isClientMessage ? `cliente-${data.clienteId}` : `usuario-${data.userId}`;
  const messageId = `erp-wa-notif-${data.contaId}-${recipientId}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;

  try {
    await new WApiClient(instance.instanceId, instance.token).send("text", {
      phone,
      message: data.message,
      messageId,
    });
  } catch (error: any) {
    console.warn(
      `[whatsapp-notifications] Falha ao enviar mensagem (conta ${data.contaId}, evento ${eventLabel})`,
      error?.response?.data || error?.message || error,
    );
    await notifyAdminsWhatsAppUnavailable(
      data.contaId,
      "erro ao enviar mensagem pela instância conectada",
    );
    // Relanca o erro para o BullMQ aplicar as tentativas com backoff.
    throw error;
  }

  return { skipped: false, messageId };
}
