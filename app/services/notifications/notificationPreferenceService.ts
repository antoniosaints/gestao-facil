import { prisma } from "../../utils/prisma";
import { enqueuePushNotification } from "../pushNotificationQueueService";
import type { NotificationPayload } from "../sendPushNotificationService";

export type NotificationPreferenceEvent =
  | "VENDA_CONCLUIDA"
  | "ESTOQUE_BAIXO"
  | "SANGRIA"
  | "PRODUTO_ALTERADO";

async function canSendEvent(contaId: number, event: NotificationPreferenceEvent) {
  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: {
      eventoVendaConcluida: true,
      eventoEstoqueBaixo: true,
      eventoSangria: true,
      eventoProdutoAlterado: true,
    },
  });

  if (!parametros) {
    return true;
  }

  switch (event) {
    case "VENDA_CONCLUIDA":
      return parametros.eventoVendaConcluida ?? true;
    case "ESTOQUE_BAIXO":
      return parametros.eventoEstoqueBaixo ?? true;
    case "SANGRIA":
      return parametros.eventoSangria ?? false;
    case "PRODUTO_ALTERADO":
      return parametros.eventoProdutoAlterado ?? true;
    default:
      return true;
  }
}

export async function enqueuePushNotificationByPreference(
  event: NotificationPreferenceEvent,
  payload: NotificationPayload,
  contaId: number,
  adminsOnly: boolean = false,
) {
  if (!(await canSendEvent(contaId, event))) {
    return false;
  }

  await enqueuePushNotification(payload, contaId, adminsOnly);
  return true;
}
