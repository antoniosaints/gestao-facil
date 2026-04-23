import { getIO } from "../../utils/socket";

export function sendSessionUpdated(contaId: number, body?: any) {
  const io = getIO();
  io.to(`conta:${contaId}`).emit("sessao:updated", body);
}
