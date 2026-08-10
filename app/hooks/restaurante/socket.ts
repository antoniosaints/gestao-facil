import { getIO } from "../../utils/socket";

export function sendRestaurantUpdate(contaId: number, event: "pedido" | "mesas" | "kds" | "impressao", body?: unknown) {
  getIO().to(`conta:${contaId}`).emit(`restaurante:${event}`, body);
}

export function sendRestaurantPublicOrderUpdate(pedidoId: number, body?: unknown) {
  getIO().to(`restaurante:pedido-publico:${pedidoId}`).emit("restaurante:pedido-publico", body);
}

export function sendRestaurantPublicSale(slug: string, body: { cliente: string; produto: string }) {
  getIO().to(`restaurante:cardapio-publico:${slug}`).emit("restaurante:compra-publica", body);
}

export function sendRestaurantDeliveryUpdate(contaId: number, body: { pedidoId: number; latitude: number; longitude: number; updatedAt: string; entregadorNome?: string }) {
  getIO().to(`conta:${contaId}`).emit("restaurante:entrega-localizacao", body);
  getIO().to(`restaurante:pedido-publico:${body.pedidoId}`).emit("restaurante:entrega-localizacao", body);
}
