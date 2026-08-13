import { Job, Worker } from "bullmq";
import { FISCAL_EMISSION_QUEUE } from "../queues/fiscalEmissionQueue";
import { processFiscalEmission, reconcilePendingFiscalDocuments } from "../services/notasFiscais/fiscalSaleService";
import { redisConnecion } from "../utils/redis";

const worker = new Worker(
  FISCAL_EMISSION_QUEUE,
  async (job: Job<{ notaFiscalId: number }>) => processFiscalEmission(job.data.notaFiscalId),
  { connection: redisConnecion, concurrency: 3 },
);

worker.on("ready", () => console.log(JSON.stringify({ event: "fiscal-worker-started" })));
worker.on("completed", (job) => console.log(JSON.stringify({ event: "fiscal-emission-completed", notaFiscalId: job.data.notaFiscalId })));
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "fiscal-emission-failed", notaFiscalId: job?.data?.notaFiscalId, attempts: job?.attemptsMade, message: error.message })));

const reconciliation = setInterval(() => {
  void reconcilePendingFiscalDocuments().catch((error) => console.error(JSON.stringify({ event: "fiscal-reconciliation-failed", message: error?.message })));
}, 60_000);

async function shutdown() {
  clearInterval(reconciliation);
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
