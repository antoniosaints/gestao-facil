import { whatsAppEventForPushPreference } from "./whatsappNotificationPolicy";
import { enqueuePushNotification } from "../pushNotificationQueueService";
import type { NotificationPayload } from "../sendPushNotificationService";
import type { PushNotificationEvent } from "./notificationChannelPolicy";

export type NotificationPreferenceEvent = Exclude<PushNotificationEvent, "VENCIMENTO_FINANCEIRO">;

export async function enqueuePushNotificationByPreference(
  event: NotificationPreferenceEvent,
  payload: NotificationPayload,
  contaId: number,
  adminsOnly: boolean = false,
) {
  // WhatsApp possui preferências próprias e independe do canal push.
  const whatsappEvent = whatsAppEventForPushPreference(event);
  if (whatsappEvent) {
    const { enqueueWhatsAppNotificationByPreference } = await import("./whatsappNotificationQueueService");
    await enqueueWhatsAppNotificationByPreference(whatsappEvent, payload, contaId, adminsOnly);
  }
  return enqueuePushNotification(payload, contaId, adminsOnly, event);
}
