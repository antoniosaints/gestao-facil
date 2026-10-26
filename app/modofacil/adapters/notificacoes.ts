import { enqueuePushNotificationByPreference } from "../../services/notifications/notificationPreferenceService";

// Never return a failed mutation after the DB has committed. Replay of a
// creation skips this adapter; it never creates a second product or movement.
export async function notificarProduto(contaId: number, title: string, message: string) {
  try {
    await enqueuePushNotificationByPreference("PRODUTO_ALTERADO", { title, body: message }, contaId);
  } catch {
    console.warn("[modofacil] Operação persistida; notificação indisponível.");
  }
}
