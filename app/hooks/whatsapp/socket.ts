import { getIO } from "../../utils/socket";
import { redisConnecion } from "../../utils/redis";
import { WHATSAPP_REALTIME_CHANNEL } from "./realtimeChannel";

function emitToConta(contaId: number, event: string, body?: any) {
  try {
    getIO().to(`conta:${contaId}`).emit(event, body);
  } catch (error) {
    // Workers nÃ£o inicializam Socket.IO. Publicam um sinal best-effort para qualquer
    // processo HTTP emitir via Redis adapter; a tela tambÃ©m reconcilia pelo banco.
    void redisConnecion.publish(
      WHATSAPP_REALTIME_CHANNEL,
      JSON.stringify({ contaId, event, body }),
    ).catch((publishError) => {
      console.warn(JSON.stringify({
        event: "whatsapp-realtime-publish-failed",
        contaId,
        socketEvent: event,
        message: String((publishError as any)?.message || publishError || error),
      }));
    });
  }
}

export function sendWhatsAppInstanceUpdated(contaId: number, body?: any) {
  emitToConta(contaId, "whatsapp:instancia:updated", body);
}

export function sendWhatsAppConversationUpdated(contaId: number, body?: any) {
  emitToConta(contaId, "whatsapp:conversa:updated", body);
}

export function sendWhatsAppMessageCreated(contaId: number, body?: any) {
  emitToConta(contaId, "whatsapp:mensagem:created", body);
}

export function sendWhatsAppConversationDeleted(contaId: number, body?: any) {
  emitToConta(contaId, "whatsapp:conversa:deleted", body);
}

export function sendWhatsAppContactDeleted(contaId: number, body?: any) {
  emitToConta(contaId, "whatsapp:contato:deleted", body);
}
