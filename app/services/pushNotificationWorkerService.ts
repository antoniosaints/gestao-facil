import webPush from "web-push";
import { prisma } from "../utils/prisma";
import { env } from "../utils/dotenv";

webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

type PushJobData = {
  subscription: webPush.PushSubscription;
  payload: unknown;
};

export async function handlePushNotification({
  subscription,
  payload,
}: PushJobData) {
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
