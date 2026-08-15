export type PresenceSocket = {
  data?: {
    contaId?: number;
    userId?: number;
    presenceEligible?: boolean;
  };
};

export function countUniqueOnlineUsers(sockets: PresenceSocket[], contaId: number): number {
  return new Set(
    sockets
      .filter(
        (socket) =>
          socket.data?.presenceEligible === true &&
          socket.data.contaId === contaId &&
          Number.isInteger(socket.data.userId),
      )
      .map((socket) => socket.data!.userId!),
  ).size;
}
