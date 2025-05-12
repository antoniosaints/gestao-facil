import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { handlePushNotification } from "../services/pushNotificationWorkerService";

export const createPushWorker = () => {
  const worker = new Worker(
    "push",
    async (job: Job) => {
      await handlePushNotification(job.data);
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    }
  );

   worker.on("ready", () => {
    console.log("Worker de envio de notificações iniciado com sucesso!");
  });

  return worker;
};

const worker = createPushWorker();
process.on('SIGINT', async () => {
  console.log('Encerrando o worker...');
  await worker.close();
  process.exit(0);
});
