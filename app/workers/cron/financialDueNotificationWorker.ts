import { Job, Worker } from "bullmq";

import {
  FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
  financialDueNotificationQueue,
} from "../../queues/financialDueNotificationQueue";
import { processFinancialDueNotifications } from "../../services/financeiro/financialDueNotificationService";
import { redisConnecion } from "../../utils/redis";

async function ensureFinancialDueNotificationSchedule() {
  const existing = await financialDueNotificationQueue.getJobSchedulers();
  const exists = existing.some((job) => job.name === FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME);

  if (!exists) {
    await financialDueNotificationQueue.add(
      FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
      {},
      {
        repeat: {
          pattern: "0 8 * * *",
        },
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
  }
}

export const financialDueNotificationWorker = () => {
  ensureFinancialDueNotificationSchedule().catch((error) => {
    console.error("[financialDueNotifications] erro ao agendar worker:", error);
  });

  const worker = new Worker(
    FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
    async (job: Job) => {
      const summary = await processFinancialDueNotifications();
      console.log(
        `[financialDueNotifications] job=${job.id} checked=${summary.checked} sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed}`,
      );

      if (summary.errors.length) {
        console.error("[financialDueNotifications] errors:", summary.errors);
      }

      return summary;
    },
    {
      connection: redisConnecion,
      concurrency: 1,
    },
  );

  worker.on("ready", () => {
    console.log("Worker de notificacoes de vencimentos financeiros iniciado com sucesso!");
  });

  worker.on("failed", (job, err) => {
    console.error("[financialDueNotifications] erro no job:", job?.id, err);
  });

  return worker;
};
