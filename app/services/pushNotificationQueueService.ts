import { pushNotificationQueue } from "../queues/pushNotificationQueue";
import { prisma } from "../utils/prisma";

type NotificationPayload = {
  title: string;
  body: string;
};
export async function canReceivePush(userId: number): Promise<boolean> {
  const usuario = await prisma.usuarios.findUnique({
    where: {id: userId},
  })
  if (!usuario) return false;
  return usuario.pushReceiver!;
}

export async function enqueuePushNotification(payload: NotificationPayload, contaId: number) {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      Usuarios: {
        pushReceiver: true,
        contaId: contaId
      }
    }
  });
  if (subscriptions.length === 0) {
    console.log("Nenhuma inscrição encontrada.");
    return;
  }

  await Promise.all(
    subscriptions.map((subscription) =>
      pushNotificationQueue.add(
        "send",
        {
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
        },
        {
          jobId: `${subscription.endpoint}-${Date.now()}`, // opcional, evita duplicações
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000, // 5 segundos
          },
          removeOnComplete: true,
          removeOnFail: 10,
        }
      )
    )
  );
}
