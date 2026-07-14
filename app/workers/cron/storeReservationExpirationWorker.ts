import { Worker } from "bullmq";
import { redisConnecion } from "../../utils/redis";
import { expireStoreReservations } from "../../services/loja/lojaOrderService";

export function storeReservationExpirationWorker() {
  return new Worker(
    "store-reservation-expiration",
    async () => ({ expired: await expireStoreReservations() }),
    { connection: redisConnecion, concurrency: 1 },
  );
}
