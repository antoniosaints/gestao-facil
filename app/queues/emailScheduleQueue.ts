import { Queue } from "bullmq";
import { redisConnecion } from "../utils/redis";

const connection = redisConnecion;

export const emailScheduleQueue = new Queue("email", {
  connection,
});
