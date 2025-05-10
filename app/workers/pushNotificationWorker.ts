import { Job, Worker } from "bullmq";
import { redisConnecion } from "../utils/redis";
import { handlePushNotification } from "../services/pushNotificationWorkerService";

export const createPushWorker = () => {
  return new Worker(
    "push",
    async (job: Job) => {
      await handlePushNotification(job.data);
    },
    {
      connection: redisConnecion,
      concurrency: 10,
    }
  );
};

createPushWorker();
