import { Job, Queue, Worker } from "bullmq";
import { redisConnecion } from "../../utils/redis";

const financeQueue = "recurrencyFinance";
const queue = new Queue(financeQueue, {
  connection: redisConnecion,
});

// evita múltiplos cron jobs duplicados
(async () => {
  const existing = await queue.getJobSchedulers();
  if (existing.length === 0) {
    await queue.add(
      "cron",
      {},
      {
        repeat: {
          pattern: "0 3 * * *",
        },
        removeOnComplete: true,
        removeOnFail: true,
      }
    );
  }
})();

export const recurrencyFinanceWorker = () => {
  const worker = new Worker(
    financeQueue,
    async (job: Job) => {
      console.log(`Worker rodou o job ${job.name} com o id ${job.id}`);
      // aqui você executa a lógica diária
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    }
  );

  worker.on("ready", () => {
    console.log("Worker de gerenciamento financeiro iniciado com sucesso!");
  });

  worker.on("failed", (job, err) => {
    console.error("Erro no job:", job?.id, err);
  });

  return worker;
};