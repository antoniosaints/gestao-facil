import { Queue } from "bullmq";
import type { ResendEmailJobData } from "../services/email/resendEmailJob";
import { redisConnecion } from "../utils/redis";

export const EMAIL_QUEUE_NAME = "email";

export const emailScheduleQueue = new Queue<ResendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: redisConnecion,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: "exponential",
      delay: 5_000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 1_000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 5_000,
    },
  },
});

export async function enqueueResendEmail(data: ResendEmailJobData) {
  return emailScheduleQueue.add("resend", data);
}
