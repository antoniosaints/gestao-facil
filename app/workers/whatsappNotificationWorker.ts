import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { WHATSAPP_NOTIFICATION_QUEUE_NAME } from "../queues/whatsappNotificationQueue";
import { handleWhatsAppNotificationJob } from "../services/notifications/whatsappNotificationWorkerService";
import { requeuePendingRestaurantWhatsAppNotifications } from "../services/restaurante/whatsappNotifications";

const RESTAURANT_OUTBOX_RECOVERY_INTERVAL_MS = 60_000;

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

  const recoverRestaurantOutbox = async () => {
    try {
      const result = await requeuePendingRestaurantWhatsAppNotifications();
      if (result.recovered || result.failures) {
        console.log(
          `[restaurante-whatsapp] Outbox recuperada: ${result.recovered} reenfileirada(s), ${result.failures} falha(s).`,
        );
      }
    } catch (error) {
      console.warn("[restaurante-whatsapp] Falha ao recuperar a outbox pendente.", error);
    }
  };
  const recoveryTimer = setInterval(() => void recoverRestaurantOutbox(), RESTAURANT_OUTBOX_RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();

  worker.on("ready", () => {
    console.log("Worker de notificacoes WhatsApp iniciado com sucesso!");
    void recoverRestaurantOutbox();
  });

  worker.on("closed", () => clearInterval(recoveryTimer));

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
