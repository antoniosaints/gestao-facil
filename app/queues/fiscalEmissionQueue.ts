import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

export const FISCAL_EMISSION_QUEUE = "fiscal-emission";

export const fiscalEmissionQueue = new Queue<{ notaFiscalId: number }>(FISCAL_EMISSION_QUEUE, {
  connection: redisConnecion,
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 5_000 },
  },
});

export async function enqueueFiscalEmission(notaFiscalId: number) {
  return fiscalEmissionQueue.add("emit", { notaFiscalId }, { jobId: `nota-fiscal:${notaFiscalId}` });
}
