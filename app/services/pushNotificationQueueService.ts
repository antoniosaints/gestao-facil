import { pushNotificationQueue } from "../queues/pushNotificationQueue";
import { prisma } from "../utils/prisma";
import {
  isPushNotificationEnabled,
  pushNotificationSelect,
  type PushNotificationEvent,
} from "./notifications/notificationChannelPolicy";

type NotificationPayload = {
  title: string;
  body: string;
};
export async function canReceivePush(userId: number): Promise<boolean> {
  const usuario = await prisma.usuarios.findUnique({
    where: { id: userId },
  });
  if (!usuario) return false;
  return usuario.pushReceiver!;
}

function gerarJobId(prefix: string = "job"): string {
  const random = Math.random().toString(36).substring(2, 8); // parte aleatória
  const timestamp = Date.now().toString(36); // baseado no tempo
  return `${prefix}_${timestamp}_${random}`;
}

export async function enqueuePushNotification(
  payload: NotificationPayload,
  contaId: number,
  adminsOnly: boolean = false,
  event?: PushNotificationEvent,
) {
  const preferences = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: pushNotificationSelect,
  });
  if (!isPushNotificationEnabled(preferences, event)) return false;

  const subscriptions = await prisma.subscription.findMany({
    where: {
      Usuarios: {
        pushReceiver: true,
        contaId: contaId,
        permissao: adminsOnly ? { in: ["admin", "root"] } : undefined,
      },
    },
  });
  if (subscriptions.length === 0) {
    console.log("Nenhuma inscrição encontrada.");
    return false;
  }

  await Promise.all(
    subscriptions.map((subscription) =>
      pushNotificationQueue.add(
        "send",
        {
          contaId,
          event,
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
          jobId: `${gerarJobId("push")}_${Date.now()}`, // opcional, evita duplicações
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
  return true;
}
