import { getIO } from "../../utils/socket";

export function sendFinanceiroUpdated(contaId: number, body?: any) {
  const io = getIO();
  io.to(`conta:${contaId}`).emit("financeiro:updated", body);
}
