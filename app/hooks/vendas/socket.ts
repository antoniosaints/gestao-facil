import { getIO } from "../../utils/socket";

export const sendUpdateTable = async (contaId: number, body?: any) => {
  const io = getIO();
  io.to(`conta:${contaId}`).emit("vendas:updatetable", body);
};
