import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { sendEmailQueue } from "../utils/email";

export const sendEmailWorker = () => {
  return new Worker(
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
};

const worker = sendEmailWorker();
process.on('SIGINT', async () => {
  console.log('Encerrando o worker...');
  await worker.close();
  process.exit(0);
});
