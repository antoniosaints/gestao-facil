import crypto from "crypto";
import { WhatsAppInstanciaStatus } from "../../../generated";
import { whatsappNotificationQueue } from "../../queues/whatsappNotificationQueue";
import { contaHasActiveModule } from "../contas/storeModulesService";
import { prisma } from "../../utils/prisma";
import {
  buildWhatsAppNotificationText,
  isWhatsAppNotificationEventEnabled,
  selectWhatsAppNotificationRecipients,
  type WhatsAppNotificationEvent,
} from "./whatsappNotificationPolicy";

export interface WhatsAppNotificationPayload {
  title: string;
  body: string;
}

export interface WhatsAppNotificationJobData extends WhatsAppNotificationPayload {
  contaId: number;
  event: WhatsAppNotificationEvent;
  instanceId: number;
  userId: number;
  phone: string;
  message: string;
}

const PARAMETER_SELECT = {
  whatsappNotificacoesAtivo: true,
  whatsappNotificacoesInstanciaId: true,
  whatsappEventoNovaVenda: true,
  whatsappEventoNovaOs: true,
  whatsappEventoNovoLancamento: true,
  whatsappEventoNovoCliente: true,
  whatsappEventoComandaFaturada: true,
  whatsappEventoCaixaAberto: true,
  whatsappEventoCaixaFechado: true,
} as const;

function buildJobId(input: {
  contaId: number;
  event: WhatsAppNotificationEvent;
  userId: number;
  phone: string;
}) {
  const hash = crypto
    .createHash("sha1")
    .update(`${input.contaId}:${input.event}:${input.userId}:${input.phone}:${Date.now()}`)
    .digest("hex")
    .slice(0, 12);

  return `wa-notif:${input.contaId}:${input.event}:${input.userId}:${hash}`;
}

export async function enqueueWhatsAppNotificationByPreference(
  event: WhatsAppNotificationEvent,
  payload: WhatsAppNotificationPayload,
  contaId: number,
) {
  try {
    const parametros = await prisma.parametrosConta.findUnique({
      where: {
        contaId,
      },
      select: PARAMETER_SELECT,
    });

    if (!parametros || !isWhatsAppNotificationEventEnabled(parametros, event)) {
      return false;
    }

    const moduleActive = await contaHasActiveModule(contaId, "whatsapp");
    if (!moduleActive || !parametros.whatsappNotificacoesInstanciaId) {
      return false;
    }

    const instance = await prisma.whatsAppInstancia.findFirst({
      where: {
        id: parametros.whatsappNotificacoesInstanciaId,
        contaId,
        ativo: true,
        status: WhatsAppInstanciaStatus.CONECTADA,
      },
      select: {
        id: true,
      },
    });

    if (!instance) {
      return false;
    }

    const users = await prisma.usuarios.findMany({
      where: {
        contaId,
        status: "ATIVO",
        permissao: {
          in: ["root", "admin"],
        },
      },
      select: {
        id: true,
        nome: true,
        permissao: true,
        telefone: true,
        status: true,
      },
    });

    const recipients = selectWhatsAppNotificationRecipients(users);
    if (!recipients.length) {
      return false;
    }

    const message = buildWhatsAppNotificationText(payload);

    await Promise.all(
      recipients.map((recipient) =>
        whatsappNotificationQueue.add(
          "send",
          {
            contaId,
            event,
            instanceId: instance.id,
            userId: recipient.userId,
            phone: recipient.phone,
            title: payload.title,
            body: payload.body,
            message,
          } satisfies WhatsAppNotificationJobData,
          {
            jobId: buildJobId({
              contaId,
              event,
              userId: recipient.userId,
              phone: recipient.phone,
            }),
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 5000,
            },
            removeOnComplete: true,
            removeOnFail: 50,
          },
        ),
      ),
    );

    return true;
  } catch (error) {
    console.warn(
      `[whatsapp-notifications] Falha ao enfileirar evento ${event} para conta ${contaId}`,
      error,
    );
    return false;
  }
}
