import { redisConnecion } from "../../utils/redis";

export class RedisCache {
  static async get<T>(key: string): Promise<T | null> {
    const data = await redisConnecion.get(key);
    return data ? (JSON.parse(data) as T) : null;
  }

  static async set(key: string, value: any, ttlSeconds = 60): Promise<void> {
    await redisConnecion.setex(key, ttlSeconds, JSON.stringify(value));
  }

  static async del(key: string): Promise<void> {
    await redisConnecion.del(key);
  }

  static async clearPrefix(prefix: string): Promise<void> {
    const keys = await redisConnecion.keys(`${prefix}*`);
    if (keys.length > 0) await redisConnecion.del(keys);
  }
}