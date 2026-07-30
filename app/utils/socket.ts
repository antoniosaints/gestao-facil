import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HttpServer } from "http";
import { redisConnecion } from "./redis";
import { env } from "./dotenv";
import { WHATSAPP_REALTIME_CHANNEL } from "../hooks/whatsapp/realtimeChannel";

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: [env.BASE_URL_FRONTEND, ...(env.LOJA_CORS_ALLOWLIST?.split(",").map((value) => value.trim()).filter(Boolean) ?? [])].map((value) => value.replace(/\/+$/, "")), credentials: true },
    // WebSocket puro: evita o handshake multi-request do long-polling, que quebraria
    // sem sticky session no cluster do PM2 (`instances: max`).
    transports: ["websocket"],
  });

  // Redis adapter: propaga os `emit`/broadcast entre TODAS as instâncias do cluster.
  // Sem ele, cada worker PM2 só entrega eventos aos sockets conectados nele mesmo, e
  // um webhook atendido por um worker não alcança clientes conectados em outro.
  const pubClient = redisConnecion;
  const subClient = redisConnecion.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  subClient.on("error", (error) => {
    console.error("[socket] Falha no cliente Redis (sub) do adapter", error);
  });

  const whatsappRealtimeSubscriber = redisConnecion.duplicate();
  void whatsappRealtimeSubscriber.subscribe(WHATSAPP_REALTIME_CHANNEL);
  whatsappRealtimeSubscriber.on("message", (channel, raw) => {
    if (channel !== WHATSAPP_REALTIME_CHANNEL) return;
    try {
      const message = JSON.parse(raw);
      if (!message?.contaId || !message?.event) return;
      // Cada worker HTTP recebe o pub/sub; `local` evita que o Redis adapter rebroadcast
      // novamente para todos os workers e duplique o evento em cada cliente.
      io.local.to(`conta:${message.contaId}`).emit(message.event, message.body);
    } catch (error) {
      console.warn("[socket] Evento realtime do WhatsApp inválido", error);
    }
  });
  whatsappRealtimeSubscriber.on("error", (error) => {
    console.error("[socket] Falha no subscriber realtime do WhatsApp", error);
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
