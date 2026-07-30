import { Job, Worker } from "bullmq";
import { EMAIL_QUEUE_NAME } from "../queues/emailScheduleQueue";
import { sendEmail } from "../services/email/resendEmailService";
import {
  isResendEmailJobData,
  type ResendEmailJobData,
} from "../services/email/resendEmailJob";
import { redisConnecion } from "../utils/redis";

export const sendEmailWorker = () => {
  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job: Job<ResendEmailJobData>) => {
      if (!isResendEmailJobData(job.data)) {
        throw new Error(`Job de e-mail inválido: ${job.id ?? "sem-id"}`);
      }

      const { provider: _provider, ...email } = job.data;
      const result = await sendEmail(email);
      if (!result.sent) {
        throw new Error("Resend desabilitado: RESEND_API_KEY ausente");
      }
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    },
  );

  worker.on("ready", () => {
    console.log("[worker-email] iniciado");
  });

  worker.on("completed", (job) => {
    console.log("[worker-email] e-mail processado", { jobId: job.id });
  });

  worker.on("failed", (job, error) => {
    console.error("[worker-email] tentativa falhou", {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      error: error.message,
    });
  });

  return worker;
};

const worker = sendEmailWorker();

const shutdown = async () => {
  console.log("[worker-email] encerrando");
  await worker.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
