import webPush from "web-push";
import { prisma } from "../utils/prisma";

type NotificationPayload = {
  title: string;
  body: string;
};

export async function sendPushNotification(payload: NotificationPayload) {
  const subscriptions = await prisma.subscription.findMany();
  const failedEndpoints: string[] = [];

  const message = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub: any) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          message
        );
      } catch (error) {
        console.error("Erro ao enviar notificação:", error);
        failedEndpoints.push(sub.endpoint);
      }
    })
  );

  if (failedEndpoints.length > 0) {
    await prisma.subscription.deleteMany({
      where: { endpoint: { in: failedEndpoints } },
    });
  }
}
