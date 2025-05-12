import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

const connection = redisConnecion;

export const emailScheduleQueue = new Queue("email", {
  connection,
});

// Função para remover todos os jobs da fila
export async function clearQueueEmail() {
  await emailScheduleQueue.obliterate({ force: true });
  console.log("Todos os jobs foram removidos da fila.");
}
