import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

export const FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME = "financial-due-notifications";

export const financialDueNotificationQueue = new Queue(FINANCIAL_DUE_NOTIFICATION_QUEUE_NAME, {
  connection: redisConnecion,
});
