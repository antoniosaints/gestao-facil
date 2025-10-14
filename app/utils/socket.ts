import { Server } from "socket.io";
import type { Server as HttpServer } from "http";

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: "*", // ajuste conforme o domínio do seu frontend
    },
  });

  io.on("connection", (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);

    socket.on("entrarNaConta", (contaId: number) => {
      if (!contaId) return;
      if (socket.rooms.has(`conta:${contaId}`)) return;
      socket.join(`conta:${contaId}`);
      console.log(`Socket ${socket.id} entrou na sala conta:${contaId}`);
    //   io.emit("socket:cobranca:conectado", { socketId: socket.id, contaId });
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
