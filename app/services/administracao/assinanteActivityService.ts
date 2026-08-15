import { getIO } from "../../utils/socket";
import { countUniqueOnlineUsers } from "./assinanteActivityPolicy";

export async function getContasOnlineUserCounts(contaIds: number[]): Promise<Map<number, number>> {
  const entries = await Promise.all(
    contaIds.map(async (contaId) => {
      try {
        const sockets = await getIO().in(`conta:${contaId}`).fetchSockets();
        return [contaId, countUniqueOnlineUsers(sockets, contaId)] as const;
      } catch (error) {
        console.warn(`[presenca] Falha ao consultar a conta ${contaId}:`, error);
        return [contaId, 0] as const;
      }
    }),
  );

  return new Map(entries);
}
