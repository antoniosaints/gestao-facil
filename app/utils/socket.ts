import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    // Guarda qual conta o socket está vinculado atualmente
    let contaAtual: number | null = null;

    socket.on("entrarNaConta", (contaId: number) => {
      if (!contaId) return;

      const room = `conta:${contaId}`;

      // 🔸 Se já estiver na mesma conta, ignora
      if (contaAtual === contaId) {
        console.log(`Socket ${socket.id} já está na sala ${room}`);
        return;
      }

      // 🔸 Se já estiver em outra conta, sai da anterior
      if (contaAtual) {
        const oldRoom = `conta:${contaAtual}`;
        socket.leave(oldRoom);
        console.log(`Socket ${socket.id} saiu da sala ${oldRoom}`);
      }

      // 🔸 Entra na nova sala
      socket.join(room);
      contaAtual = contaId;
      console.log(`Socket ${socket.id} entrou na sala ${room}, total de conexões: ${io.sockets.adapter.rooms.get(room)?.size}`);
    });
    socket.on("sairDaConta", (contaId: number) => {
      if (!contaId) return;

      const room = `conta:${contaId}`;

      socket.leave(room);
      contaAtual = null;
      console.log(`Socket ${socket.id} saiu da sala ${room}, total de conexões: ${io.sockets.adapter.rooms.get(room)?.size}`);
    });

    socket.on("disconnect", () => {
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error("Socket.IO não inicializado");
  return io;
}
