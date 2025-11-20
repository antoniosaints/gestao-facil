import { Job, Queue, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { sendEmailQueue } from "../utils/email";
import { clearQueueEmail } from "../queues/emailScheduleQueue";

const financeQueue = "recurrencyFinance";
const queue = new Queue(financeQueue, {
  connection: redisConnecion,
});

queue.add(financeQueue, {}, {
  repeat: {
    pattern: "0 3 * * *",
  },
  removeOnComplete: true,
  removeOnFail: true
})

export const recurrencyFinanceWorker = () => {
  clearQueueEmail();
  const worker = new Worker(
    financeQueue,
    async (job: Job) => {
      console.log("Worker de recorrencia financeira rodou!");
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    }
  );

  worker.on("ready", () => {
    console.log("Worker de gerenciamento financeiro iniciado com sucesso!");
  });

  return worker;
};

const worker = recurrencyFinanceWorker();
process.on("SIGINT", async () => {
  console.log("Encerrando o worker...");
  await worker.close();
  process.exit(0);
});
