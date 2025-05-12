import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { sendEmailQueue } from "../utils/email";

export const sendEmailWorker = () => {
  const worker = new Worker(
    "email",
    async (job: Job) => {
      try {
        const { to, subject, text } = job.data;
        await sendEmailQueue(to, subject, text);
      } catch (error) {
        throw error;
      }
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    }
  );

  worker.on("ready", () => {
    console.log("Worker de envio de email iniciado com sucesso!");
  });

  return worker;
};

const worker = sendEmailWorker();
process.on('SIGINT', async () => {
  console.log('Encerrando o worker...');
  await worker.close();
  process.exit(0);
});
