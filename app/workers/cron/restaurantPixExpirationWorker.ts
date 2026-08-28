import { Worker } from "bullmq";
import { sendRestaurantPublicOrderUpdate, sendRestaurantUpdate } from "../../hooks/restaurante/socket";
import { expireRestaurantPendingPixOrders } from "../../services/restaurante/payment";
import { redisConnecion } from "../../utils/redis";

export function restaurantPixExpirationWorker() {
  return new Worker(
    "restaurant-pix-expiration",
    async () => {
      const result = await expireRestaurantPendingPixOrders();
      for (const order of [...result.expired, ...result.paidDuringExpiration]) {
        sendRestaurantUpdate(order.contaId, "pedido", { pedidoId: order.id });
        sendRestaurantUpdate(order.contaId, "kds", { pedidoId: order.id });
        sendRestaurantUpdate(order.contaId, "impressao", { pedidoId: order.id });
        sendRestaurantPublicOrderUpdate(order.id, { pedidoId: order.id });
      }
      return {
        expired: result.expired.length,
        paidDuringExpiration: result.paidDuringExpiration.length,
      };
    },
    { connection: redisConnecion, concurrency: 1 },
  );
}
