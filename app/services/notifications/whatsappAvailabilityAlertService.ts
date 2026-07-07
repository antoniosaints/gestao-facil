import { redisConnecion } from "../../utils/redis";
import { enqueuePushNotification } from "../pushNotificationQueueService";

const ALERT_THROTTLE_SECONDS = 30 * 60; // 1 alerta por conta a cada 30 minutos

function buildAlertKey(contaId: number) {
  return `wa-notif:availability-alert:${contaId}`;
}

/**
 * Envia uma notificacao push somente para os admins da conta avisando que a
 * integracao com o WhatsApp esta indisponivel (desconectada ou com erro).
 *
 * O alerta e limitado a 1 envio por conta a cada ALERT_THROTTLE_SECONDS para
 * evitar spam quando varios jobs falharem em sequencia.
 */
export async function notifyAdminsWhatsAppUnavailable(
  contaId: number,
  motivo: string,
) {
  try {
    const created = await redisConnecion.set(
      buildAlertKey(contaId),
      "1",
      "EX",
      ALERT_THROTTLE_SECONDS,
      "NX",
    );

    if (!created) {
      return false;
    }

    await enqueuePushNotification(
      {
        title: "⚠️ WhatsApp com problema",
        body: `Não foi possível enviar notificações via WhatsApp: ${motivo}. Verifique a conexão da instância nas configurações do WhatsApp.`,
      },
      contaId,
      true,
    );

    return true;
  } catch (error) {
    console.warn(
      `[whatsapp-notifications] Falha ao alertar admins da conta ${contaId} sobre indisponibilidade do WhatsApp`,
      error,
    );
    return false;
  }
}
