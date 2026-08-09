import { getIO } from "../../utils/socket";

export function sendRestaurantUpdate(contaId: number, event: "pedido" | "mesas" | "kds" | "impressao", body?: unknown) {
  getIO().to(`conta:${contaId}`).emit(`restaurante:${event}`, body);
}

export function sendRestaurantPublicOrderUpdate(pedidoId: number, body?: unknown) {
  getIO().to(`restaurante:pedido-publico:${pedidoId}`).emit("restaurante:pedido-publico", body);
}
