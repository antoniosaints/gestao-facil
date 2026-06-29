import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { WHATSAPP_NOTIFICATION_QUEUE_NAME } from "../queues/whatsappNotificationQueue";
import { handleWhatsAppNotificationJob } from "../services/notifications/whatsappNotificationWorkerService";

export const createWhatsAppNotificationWorker = () => {
  const worker = new Worker(
    WHATSAPP_NOTIFICATION_QUEUE_NAME,
    async (job: Job) => {
      await handleWhatsAppNotificationJob(job.data);
    },
    {
      connection: redisConnecion,
      concurrency: 5,
    },
  );

  worker.on("ready", () => {
    console.log("Worker de notificacoes WhatsApp iniciado com sucesso!");
  });

  worker.on("failed", (job, error) => {
    console.warn(
      `Falha ao enviar notificacao WhatsApp job=${job?.id || "unknown"}`,
      error?.message || error,
    );
  });

  return worker;
};

export const workerWhatsapp = createWhatsAppNotificationWorker();
process.on("SIGINT", async () => {
  console.log("Encerrando o worker de notificacoes WhatsApp...");
  await workerWhatsapp.close();
  process.exit(0);
});
