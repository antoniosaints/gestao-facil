import { getIO } from "../../utils/socket";

export function sendRestaurantUpdate(contaId: number, event: "pedido" | "mesas" | "kds" | "impressao", body?: unknown) {
  getIO().to(`conta:${contaId}`).emit(`restaurante:${event}`, body);
}
