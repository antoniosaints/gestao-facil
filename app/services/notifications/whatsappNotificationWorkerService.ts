import crypto from "crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { WApiClient } from "../whatsapp/wApiClient";
import { prisma } from "../../utils/prisma";
import { normalizeWhatsAppNotificationPhone } from "./whatsappNotificationPolicy";
import type { WhatsAppNotificationJobData } from "./whatsappNotificationQueueService";

export async function handleWhatsAppNotificationJob(data: WhatsAppNotificationJobData) {
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
    return { skipped: true, reason: "instance-unavailable" };
  }

  const messageId = `erp-wa-notif-${data.contaId}-${data.userId}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}`;

  await new WApiClient(instance.instanceId, instance.token).send("text", {
    phone,
    message: data.message,
    messageId,
  });

  return { skipped: false, messageId };
}
