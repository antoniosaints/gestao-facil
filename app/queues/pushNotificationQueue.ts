import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

const connection = redisConnecion;

export const pushNotificationQueue = new Queue("push", {
  connection,
});
export async function clearQueuePush() {
  await pushNotificationQueue.obliterate({ force: true });
  console.log("Todos os jobs foram removidos da fila.");
}
