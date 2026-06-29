import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

export const WHATSAPP_NOTIFICATION_QUEUE_NAME = "whatsapp-notifications";

export const whatsappNotificationQueue = new Queue(WHATSAPP_NOTIFICATION_QUEUE_NAME, {
  connection: redisConnecion,
});
