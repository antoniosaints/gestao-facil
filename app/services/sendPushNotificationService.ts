import webPush from "web-push";
import { prisma } from "../utils/prisma";
import { env } from "../utils/dotenv";

webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export type NotificationPayload = {
  title: string;
  body: string;
};

export async function sendPushNotification(payload: NotificationPayload, contaId: number) {
  const subscriptions = await prisma.subscription.findMany({
     where: {
      Usuarios: {
        pushReceiver: true,
        contaId: contaId,
      },
    },
  });
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
