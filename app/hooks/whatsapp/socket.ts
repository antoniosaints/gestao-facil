import { getIO } from "../../utils/socket";

function emitToConta(contaId: number, event: string, body?: any) {
  try {
    getIO().to(`conta:${contaId}`).emit(event, body);
  } catch (error) {
    console.warn(`[whatsapp] Falha ao emitir socket ${event} para conta ${contaId}`, error);
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
