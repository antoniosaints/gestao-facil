import { createTextEmailJob } from "./email/resendEmailJob";
import { emailScheduleQueue } from "../queues/emailScheduleQueue";

export type EmailScheduleQueue = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function emailScheduleService(payload: EmailScheduleQueue) {
  await emailScheduleQueue.add("send", createTextEmailJob(payload), {
    jobId: `email-${Date.now()}`, // opcional, evita duplicações
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5 segundos
    },
    removeOnComplete: true,
    removeOnFail: 10,
  });
}
