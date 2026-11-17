import type Redis from "ioredis";
import type { ActionStore, StoredAction } from "./coreIaActions";

// Shared between API workers; pending review and execution lock expire together.
export function createCoreIaRedisStore(
  redis: Pick<Redis, "set" | "get" | "eval">,
): ActionStore {
  return {
    async put(key, action) {
      await redis.set(
        key,
        JSON.stringify(action),
        "EX",
        action.state === "done" ? 86400 : 600,
      );
    },
    async get(key) {
      const data = await redis.get(key);
      return data ? (JSON.parse(data) as StoredAction) : null;
    },
    async claim(key) {
      return (
        Number(
          await redis.eval(
            `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local action = cjson.decode(raw)
      if action.state ~= 'pending' then return 0 end
      action.state = 'executing'
      redis.call('SET', KEYS[1], cjson.encode(action), 'EX', 86400)
      return 1
    `,
            1,
            key,
          ),
        ) === 1
      );
    },
  };
}
