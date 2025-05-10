import { Job, Worker } from "bullmq";
import webPush from "web-push";
import { prisma } from "../utils/prisma";
import { redisConnecion } from "../utils/redis";
import { env } from "../utils/dotenv";

webPush.setVapidDetails(
  "mailto:costaantonio883@gmail.com",
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

const connection = redisConnecion;

new Worker(
  "push",
  async (job: Job) => {
    const { subscription, payload } = job.data;
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err: any) {
      console.error(
        `Erro ao enviar notificação para ${subscription.endpoint}`,
        err
      );

      if (err.statusCode === 410 || err.statusCode === 404) {
        await prisma.subscription.deleteMany({
          where: {
            endpoint: subscription.endpoint,
          },
        });
        console.log(`Inscrição inválida removida: ${subscription.endpoint}`);
      }

      throw err; // Faz o BullMQ tentar novamente
    }
  },
  {
    connection,
    concurrency: 10,
  }
);
