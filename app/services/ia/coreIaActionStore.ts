import Redis from "ioredis";
import { env } from "../../utils/dotenv";
import { createCoreIaRedisStore } from "./coreIaRedisStore";

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  connectTimeout: 5000,
  commandTimeout: 5000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});
redis.on("error", () => {}); // Commands reject; never log credentials or review payloads.
export const coreIaActionStore = createCoreIaRedisStore(redis);
