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
import { notifyAdminsWhatsAppUnavailable } from "./whatsappAvailabilityAlertService";
import { normalizeClienteWhatsappPhone } from "../clientes/clienteWhatsappPolicy";

export interface WhatsAppNotificationPayload {
  title: string;
  body: string;
}

export interface WhatsAppNotificationJobData extends WhatsAppNotificationPayload {
  kind?: "INTERNAL_NOTIFICATION";
  contaId: number;
  event: WhatsAppNotificationEvent;
  instanceId: number;
  userId: number;
  phone: string;
  message: string;
}

export interface WhatsAppClientMessageJobData {
  kind: "CLIENT_MESSAGE";
  contaId: number;
  instanceId: number;
  clienteId: number;
  phone: string;
  message: string;
}

export type WhatsAppQueueJobData = WhatsAppNotificationJobData | WhatsAppClientMessageJobData;

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
  financeiroVencimentosNotificacoesAtivo: true,
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

  // BullMQ (versoes mais recentes) nao permite ":" em jobIds customizados.
  return `wa-notif-${input.contaId}-${input.event}-${input.userId}-${hash}`;
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
      console.log(
        `[whatsapp-notifications] Evento ${event} ignorado (conta ${contaId}): notificacoes WhatsApp desativadas ou evento desabilitado nas configuracoes`,
      );
      return false;
    }

    const moduleActive = await contaHasActiveModule(contaId, "whatsapp");
    if (!moduleActive) {
      console.warn(
        `[whatsapp-notifications] Evento ${event} ignorado (conta ${contaId}): modulo WhatsApp inativo`,
      );
      return false;
    }

    if (!parametros.whatsappNotificacoesInstanciaId) {
      console.warn(
        `[whatsapp-notifications] Evento ${event} ignorado (conta ${contaId}): nenhuma instancia configurada nas notificacoes`,
      );
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
      // Notificacoes WhatsApp estao ativas, mas a instancia configurada nao
      // esta conectada: avisa os admins via push (com throttle) em vez de
      // falhar silenciosamente.
      console.warn(
        `[whatsapp-notifications] Evento ${event} nao enviado: instancia indisponivel na conta ${contaId}`,
      );
      await notifyAdminsWhatsAppUnavailable(
        contaId,
        "a instância configurada está desconectada ou inativa",
      );
      return false;
    }

    const users = await prisma.usuarios.findMany({
      where: {
        contaId,
        status: "ATIVO",
        permissao: {
          in: ["root", "admin", "gerente"],
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

    const recipients = selectWhatsAppNotificationRecipients(users, event);
    if (!recipients.length) {
      console.warn(
        `[whatsapp-notifications] Evento ${event} ignorado (conta ${contaId}): nenhum destinatario ativo com telefone valido`,
      );
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

    console.log(
      `[whatsapp-notifications] Evento ${event} enfileirado para ${recipients.length} destinatario(s) (conta ${contaId})`,
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

/**
 * Envio manual (reenvio) para uma instancia escolhida pelo usuario.
 * Nao passa pelas preferencias de evento: o usuario pediu o envio
 * explicitamente. A instancia precisa estar ativa e conectada.
 */
export async function enqueueWhatsAppNotificationToInstance(
  event: WhatsAppNotificationEvent,
  payload: WhatsAppNotificationPayload,
  contaId: number,
  instanciaId: number,
) {
  const instance = await prisma.whatsAppInstancia.findFirst({
    where: {
      id: instanciaId,
      contaId,
      ativo: true,
      status: WhatsAppInstanciaStatus.CONECTADA,
    },
    select: {
      id: true,
    },
  });

  if (!instance) {
    throw new Error("Instância WhatsApp não encontrada ou desconectada.");
  }

  const users = await prisma.usuarios.findMany({
    where: {
      contaId,
      status: "ATIVO",
      permissao: {
        in: ["root", "admin", "gerente"],
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

  const recipients = selectWhatsAppNotificationRecipients(users, event);
  if (!recipients.length) {
    throw new Error("Nenhum destinatário ativo com telefone válido.");
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

  console.log(
    `[whatsapp-notifications] Evento ${event} reenviado manualmente para ${recipients.length} destinatario(s) (conta ${contaId}, instancia ${instanciaId})`,
  );

  return { recipients: recipients.length };
}

/**
 * Enfileira uma mensagem solicitada manualmente para um cliente. O job não recebe
 * delay: fica disponível para o worker imediatamente e usa tentativas com backoff.
 */
export async function enqueueWhatsAppClientMessage(
  contaId: number,
  clienteId: number,
  message: string,
) {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    throw new Error("Informe a mensagem para envio.");
  }

  const moduleActive = await contaHasActiveModule(contaId, "whatsapp");
  if (!moduleActive) {
    throw new Error("O modulo WhatsApp precisa estar ativo para enviar mensagens.");
  }

  const [parametros, cliente] = await Promise.all([
    prisma.parametrosConta.findUnique({
      where: { contaId },
      select: { whatsappNotificacoesInstanciaId: true },
    }),
    prisma.clientesFornecedores.findFirst({
      where: { id: clienteId, contaId },
      select: { whastapp: true, telefone: true },
    }),
  ]);

  if (!cliente) {
    throw new Error("Cliente nao encontrado.");
  }

  const phone = normalizeClienteWhatsappPhone(cliente.whastapp || cliente.telefone);
  if (!phone) {
    throw new Error("Cliente sem telefone ou WhatsApp valido.");
  }

  if (!parametros?.whatsappNotificacoesInstanciaId) {
    throw new Error("Configure a instancia principal de WhatsApp nas notificacoes.");
  }

  const instance = await prisma.whatsAppInstancia.findFirst({
    where: {
      id: parametros.whatsappNotificacoesInstanciaId,
      contaId,
      ativo: true,
      status: WhatsAppInstanciaStatus.CONECTADA,
    },
    select: { id: true },
  });

  if (!instance) {
    throw new Error("A instancia principal de WhatsApp precisa estar conectada.");
  }

  const jobId = `wa-client-${contaId}-${clienteId}-${crypto.randomUUID()}`;
  await whatsappNotificationQueue.add(
    "send-client-message",
    {
      kind: "CLIENT_MESSAGE",
      contaId,
      instanceId: instance.id,
      clienteId,
      phone,
      message: normalizedMessage,
    } satisfies WhatsAppClientMessageJobData,
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );

  return { jobId };
}
