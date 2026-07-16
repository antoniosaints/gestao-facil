import { Job, Worker } from "bullmq";

import {
  FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
  financialDueNotificationQueue,
} from "../../queues/financialDueNotificationQueue";
import { processFinancialDueNotifications } from "../../services/financeiro/financialDueNotificationService";
import { processInadimplenciaReminders } from "../../services/financeiro/inadimplenciaReminderService";
import { DEFAULT_LEMBRETE_HORA } from "../../services/financeiro/inadimplenciaLembretePolicy";
import { redisConnecion } from "../../utils/redis";

// O job roda de HORA em hora. Os lembretes ao cliente são disparados na hora configurada
// por cada conta (ParametrosConta.inadimplenciaHoraEnvio); as notificações internas da
// equipe rodam uma vez ao dia, na hora padrão do sistema.
const HOURLY_SCHEDULE_PATTERN = "0 * * * *";
const INTERNAL_NOTIFICATION_HORA = DEFAULT_LEMBRETE_HORA;

async function ensureFinancialDueNotificationSchedule() {
  await financialDueNotificationQueue.upsertJobScheduler(
    FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
    { pattern: HOURLY_SCHEDULE_PATTERN },
    {
      name: FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
      opts: {
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    },
  );
}

export const financialDueNotificationWorker = () => {
  ensureFinancialDueNotificationSchedule().catch((error) => {
    console.error("[financialDueNotifications] erro ao agendar worker:", error);
  });

  const worker = new Worker(
    FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME,
    async (job: Job) => {
      const agora = new Date();

      // Notificações internas da equipe: uma vez ao dia, na hora padrão do sistema.
      let interno = null as Awaited<ReturnType<typeof processFinancialDueNotifications>> | null;
      if (agora.getHours() === INTERNAL_NOTIFICATION_HORA) {
        interno = await processFinancialDueNotifications();
        console.log(
          `[financialDueNotifications] job=${job.id} checked=${interno.checked} sent=${interno.sent} skipped=${interno.skipped} failed=${interno.failed}`,
        );
        if (interno.errors.length) {
          console.error("[financialDueNotifications] errors:", interno.errors);
        }
      }

      // Lembretes ao cliente: rodam toda hora, mas cada conta só na sua hora configurada.
      const inadimplencia = await processInadimplenciaReminders(agora);
      if (inadimplencia.checked > 0 || inadimplencia.sent > 0) {
        console.log(
          `[inadimplenciaReminders] job=${job.id} checked=${inadimplencia.checked} sent=${inadimplencia.sent} skipped=${inadimplencia.skipped} failed=${inadimplencia.failed}`,
        );
      }
      if (inadimplencia.errors.length) {
        console.error("[inadimplenciaReminders] errors:", inadimplencia.errors);
      }

      return { interno, inadimplencia };
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
