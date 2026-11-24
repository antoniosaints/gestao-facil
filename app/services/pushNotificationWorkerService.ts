import webPush from "web-push";
import { prisma } from "../utils/prisma";
import { env } from "../utils/dotenv";
import {
  isPushNotificationEnabled,
  pushNotificationSelect,
  type PushNotificationEvent,
} from "./notifications/notificationChannelPolicy";

webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

type PushJobData = {
  subscription: webPush.PushSubscription;
  payload: unknown;
  contaId?: number;
  event?: PushNotificationEvent;
};

export async function handlePushNotification({
  subscription,
  payload,
  contaId,
  event,
}: PushJobData) {
  const recipient = await prisma.subscription.findFirst({
    where: {
      endpoint: subscription.endpoint,
      auth: subscription.keys.auth,
      p256dh: subscription.keys.p256dh,
      Usuarios: { contaId, pushReceiver: true },
    },
    select: { Usuarios: { select: { contaId: true } } },
  });
  if (!recipient) return;
  const preferences = await prisma.parametrosConta.findUnique({
    where: { contaId: recipient.Usuarios.contaId },
    select: pushNotificationSelect,
  });
  if (!isPushNotificationEnabled(preferences, event)) return;

  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err: any) {
    console.error(
      `Erro ao enviar notificação para ${subscription.endpoint}`,
      err
    );

    if (err.statusCode === 410 || err.statusCode === 404) {
      await removeInvalidSubscription(subscription.endpoint);
    }

    throw err;
  }
}

async function removeInvalidSubscription(endpoint: string) {
  await prisma.subscription.deleteMany({
    where: { endpoint },
  });
  console.log(`Inscrição inválida removida: ${endpoint}`);
}
