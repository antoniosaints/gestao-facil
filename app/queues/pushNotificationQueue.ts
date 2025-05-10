import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

const connection = redisConnecion;

export const pushNotificationQueue = new Queue("push", {
  connection,
});
