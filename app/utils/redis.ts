import Redis from "ioredis";
import { env } from "./dotenv";

export const redisConnecion = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});
