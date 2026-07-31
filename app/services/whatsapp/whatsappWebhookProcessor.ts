import {
  Prisma,
  WhatsAppConversaStatus,
  WhatsAppInstanciaStatus,
  WhatsAppMensagemDirecao,
  WhatsAppMensagemOrigem,
  WhatsAppMensagemStatus,
} from "../../../generated";
import { prisma } from "../../utils/prisma";
import {
  sendWhatsAppConversationUpdated,
  sendWhatsAppInstanceUpdated,
  sendWhatsAppMessageCreated,
} from "../../hooks/whatsapp/socket";
import { resolverTransicaoAtendimento } from "./whatsappAtendimento";
import { mapWApiInstanceStatusFromPayload } from "./whatsappPolicy";
import { whatsAppAgentService } from "./whatsappAgentService";
import { wApiMessageIdFromResponse } from "./wApiClient";
import {
  extractMessagePayload,
  instanceAtendimentoPaused,
  mapMessageStatus,
  publicInstance,
  safeJson,
} from "./whatsappService";

export class DeferredWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferredWebhookError";
  }
}

type TransactionResult = {
  contaId: number;
  instance?: any;
  conversation?: any;
  message?: any;
  agentInput?: {
    instance: { id: number; instanceId: string; token: string };
    conversa: { id: number; telefone: string; status: WhatsAppConversaStatus; atendenteId: number | null };
    incoming: { conteudo: string; tipo: any };
    incomingMessageId: number;
    payload: any;
  };
};

function messageIdFromPayload(payload: any): string {
  return String(payload?.messageId || payload?.data?.messageId || payload?.id || payload?.data?.id || "");
}

async function findAutoCliente(tx: Prisma.TransactionClient, contaId: number, phone: string) {
  const lastDigits = phone.slice(-8);
  return tx.clientesFornecedores.findFirst({
    where: {
      contaId,
      OR: [
        { telefone: { contains: phone } },
        { whastapp: { contains: phone } },
        ...(lastDigits ? [{ telefone: { contains: lastDigits } }, { whastapp: { contains: lastDigits } }] : []),
      ],
    },
    select: { id: true, nome: true, telefone: true, whastapp: true },
  });
}

function parseReactions(value?: string | null): Array<{ emoji: string; fromMe: boolean; senderId: string | null }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function markIgnored(tx: Prisma.TransactionClient, id: number, reason: string) {
  await tx.whatsAppWebhookEvento.update({
    where: { id },
    data: {
      status: "IGNORADO",
      processado: true,
      processedAt: new Date(),
      motivoIgnorado: reason,
      erro: null,
      bloqueadoEm: null,
      workerId: null,
      proximaTentativaEm: null,
    },
  });
}

async function markProcessed(tx: Prisma.TransactionClient, id: number) {
  await tx.whatsAppWebhookEvento.update({
    where: { id },
    data: {
      status: "PROCESSADO",
      processado: true,
      processedAt: new Date(),
      erro: null,
      motivoIgnorado: null,
      bloqueadoEm: null,
      workerId: null,
      proximaTentativaEm: null,
    },
  });
}

export async function processClaimedWebhookEvent(eventDatabaseId: number): Promise<void> {
  const result = await prisma.$transaction(async (tx): Promise<TransactionResult> => {
    const event = await tx.whatsAppWebhookEvento.findUnique({ where: { id: eventDatabaseId } });
    if (!event || event.status !== "PROCESSANDO") {
      throw new Error(`Evento ${eventDatabaseId} não está disponível para processamento`);
    }

    const instance = await tx.whatsAppInstancia.findUnique({ where: { id: event.instanciaId } });
    if (!instance || !instance.ativo) {
      await markIgnored(tx, event.id, "instancia-inativa-ou-removida");
      return { contaId: event.contaId };
    }

    let payload: any;
    try {
      payload = JSON.parse(event.payload);
    } catch {
      await markIgnored(tx, event.id, "payload-json-invalido");
      return { contaId: event.contaId };
    }

    let emittedInstance: any;
    let emittedConversation: any;
    let emittedMessage: any;
    let agentInput: TransactionResult["agentInput"];

    let nextStatus: WhatsAppInstanciaStatus | null = null;
    if (event.tipo === "connected") nextStatus = WhatsAppInstanciaStatus.CONECTADA;
    if (event.tipo === "disconnected") nextStatus = WhatsAppInstanciaStatus.DESCONECTADA;
    if (event.tipo === "status") {
      const mapped = mapWApiInstanceStatusFromPayload(payload);
      if (mapped !== "PENDENTE") nextStatus = mapped as WhatsAppInstanciaStatus;
    }
    if (
      event.tipo === "received" &&
      (instance.status === WhatsAppInstanciaStatus.PENDENTE ||
        instance.status === WhatsAppInstanciaStatus.CONECTANDO)
    ) {
      nextStatus = WhatsAppInstanciaStatus.CONECTADA;
    }
    if (nextStatus && nextStatus !== instance.status) {
      emittedInstance = await tx.whatsAppInstancia.update({
        where: { id: instance.id },
        data: { status: nextStatus, lastSyncAt: new Date(), ultimoErro: null },
      });
    }

    const isMessageEvent =
      ["received", "delivery"].includes(event.tipo) ||
      Boolean(payload?.msgContent || payload?.message || payload?.data?.message || payload?.data?.messageId);

    const isDeliveryStatusEvent =
      event.tipo === "delivery" ||
      (event.tipo === "status" && Boolean(messageIdFromPayload(payload)));
    if (isMessageEvent && isDeliveryStatusEvent) {
      const externalMessageId = messageIdFromPayload(payload);
      if (!externalMessageId) {
        await markIgnored(tx, event.id, "delivery-sem-message-id");
        return { contaId: instance.contaId, instance: emittedInstance };
      }
      let existing = await tx.whatsAppMensagem.findUnique({
        where: {
          contaId_instanciaId_externalMessageId: {
            contaId: instance.contaId,
            instanciaId: instance.id,
            externalMessageId,
          },
        },
      });

      // Mensagens enviadas antes da correção guardavam o id real da W-API apenas no
      // rawPayload e mantinham um `erp-*` em externalMessageId. Recuperamos esses registros
      // para que os deliveries já pendentes também possam ser processados.
      if (!existing) {
        const legacyCandidates = await tx.whatsAppMensagem.findMany({
          where: {
            contaId: instance.contaId,
            instanciaId: instance.id,
            rawPayload: { contains: externalMessageId },
          },
          orderBy: { id: "desc" },
          take: 20,
        });
        const legacyMatch = legacyCandidates.find((candidate) => {
          try {
            return wApiMessageIdFromResponse(JSON.parse(candidate.rawPayload || "{}")) === externalMessageId;
          } catch {
            return false;
          }
        });
        if (legacyMatch) {
          existing = await tx.whatsAppMensagem.update({
            where: { id: legacyMatch.id },
            data: { externalMessageId },
          });
        }
      }

      if (!existing) {
        await markIgnored(tx, event.id, "delivery-de-envio-nao-rastreado");
        return { contaId: instance.contaId, instance: emittedInstance };
      }
      const statusEnvio = mapMessageStatus(payload);
      emittedMessage = await tx.whatsAppMensagem.update({
        where: { id: existing.id },
        data: {
          statusEnvio,
          ...(statusEnvio === WhatsAppMensagemStatus.LIDA ? { lidoEm: new Date() } : {}),
        },
      });
    }

    if (isMessageEvent && event.tipo !== "delivery") {
      const protocolMessage =
        payload?.msgContent?.protocolMessage || payload?.message?.protocolMessage || payload?.data?.message?.protocolMessage;
      const reactionMessage =
        payload?.msgContent?.reactionMessage || payload?.message?.reactionMessage || payload?.data?.message?.reactionMessage;
      const msg = extractMessagePayload(payload);

      if (msg.isGroup || msg.isStatusBroadcast || msg.isChannel) {
        await markIgnored(
          tx,
          event.id,
          msg.isGroup ? "grupo-nao-suportado" : msg.isStatusBroadcast ? "status-nao-suportado" : "canal-nao-suportado",
        );
        return { contaId: instance.contaId, instance: emittedInstance };
      }

      if (reactionMessage) {
        const reactedId = String(reactionMessage?.key?.ID || reactionMessage?.key?.id || "");
        const target = reactedId
          ? await tx.whatsAppMensagem.findFirst({
              where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: reactedId },
            })
          : null;
        if (!target) throw new DeferredWebhookError("Mensagem referenciada pela reação ainda não foi persistida");
        const fromMe = Boolean(payload?.fromMe ?? reactionMessage?.key?.fromMe);
        const senderId = String(payload?.sender?.id ?? "").trim() || null;
        const authorKey = fromMe ? "__me__" : senderId || "__them__";
        const reactions = parseReactions(target.reacoes).filter((item) =>
          (item.fromMe ? "__me__" : item.senderId || "__them__") !== authorKey,
        );
        const emoji = typeof reactionMessage?.text === "string" ? reactionMessage.text : "";
        if (emoji) reactions.push({ emoji, fromMe, senderId });
        emittedMessage = await tx.whatsAppMensagem.update({
          where: { id: target.id },
          data: { reacoes: reactions.length ? JSON.stringify(reactions) : null },
        });
      } else if (protocolMessage?.type === "REVOKE") {
        const revokedId = String(protocolMessage?.key?.ID || protocolMessage?.key?.id || "");
        const target = revokedId
          ? await tx.whatsAppMensagem.findFirst({
              where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: revokedId },
            })
          : null;
        if (!target) throw new DeferredWebhookError("Mensagem referenciada pela exclusão ainda não foi persistida");
        emittedMessage = await tx.whatsAppMensagem.update({
          where: { id: target.id },
          data: { apagadaEm: target.apagadaEm || new Date() },
        });
      } else {
        if (!msg.phone) {
          await markIgnored(tx, event.id, "mensagem-sem-telefone");
          return { contaId: instance.contaId, instance: emittedInstance };
        }

        const alreadyPersisted = await tx.whatsAppMensagem.findUnique({
          where: {
            contaId_instanciaId_externalMessageId: {
              contaId: instance.contaId,
              instanciaId: instance.id,
              externalMessageId: msg.externalMessageId,
            },
          },
        });
        if (alreadyPersisted) {
          emittedMessage = await tx.whatsAppMensagem.update({
            where: { id: alreadyPersisted.id },
            data: { rawPayload: safeJson(payload) },
          });
        } else {
          const autoCliente = await findAutoCliente(tx, instance.contaId, msg.phone);
          const existingContato = await tx.whatsAppContato.findUnique({
            where: { contaId_telefone: { contaId: instance.contaId, telefone: msg.phone } },
            select: { nomeManual: true },
          });
          const contato = await tx.whatsAppContato.upsert({
            where: { contaId_telefone: { contaId: instance.contaId, telefone: msg.phone } },
            update: {
              ...(existingContato?.nomeManual ? {} : { nome: msg.pushName || undefined }),
              foto: msg.foto || undefined,
              clienteId: autoCliente?.id || undefined,
              dadosAuxiliares: safeJson({ lastWebhookAt: new Date().toISOString() }),
            },
            create: {
              contaId: instance.contaId,
              telefone: msg.phone,
              nome: msg.pushName || null,
              foto: msg.foto || null,
              clienteId: autoCliente?.id || null,
              dadosAuxiliares: safeJson({ createdBy: "whatsapp-webhook" }),
            },
          });

          const previousConversation = await tx.whatsAppConversa.findUnique({
            where: {
              contaId_instanciaId_telefone: {
                contaId: instance.contaId,
                instanciaId: instance.id,
                telefone: msg.phone,
              },
            },
          });
          const nextConversationStatus = msg.fromMe
            ? WhatsAppConversaStatus.ABERTA
            : previousConversation?.status === WhatsAppConversaStatus.ABERTA
              ? WhatsAppConversaStatus.ABERTA
              : WhatsAppConversaStatus.PENDENTE;
          const transition = resolverTransicaoAtendimento({
            statusAnterior: previousConversation?.status ?? null,
            statusNovo: nextConversationStatus,
            filaDesde: previousConversation?.filaDesde ?? null,
            atendidaEm: previousConversation?.atendidaEm ?? null,
            agora: new Date(),
          });

          emittedConversation = await tx.whatsAppConversa.upsert({
            where: {
              contaId_instanciaId_telefone: {
                contaId: instance.contaId,
                instanciaId: instance.id,
                telefone: msg.phone,
              },
            },
            update: {
              contatoId: contato.id,
              clienteId: contato.clienteId || autoCliente?.id || undefined,
              status: nextConversationStatus,
              ultimaMensagem: msg.conteudo || `[${String(msg.tipo).toLowerCase()}]`,
              ultimaInteracaoEm: new Date(),
              ...(msg.fromMe ? {} : { naoLidas: { increment: 1 } }),
              ...(transition.filaDesde !== undefined ? { filaDesde: transition.filaDesde } : {}),
              ...(transition.atendidaEm !== undefined ? { atendidaEm: transition.atendidaEm } : {}),
            },
            create: {
              contaId: instance.contaId,
              instanciaId: instance.id,
              contatoId: contato.id,
              clienteId: contato.clienteId || autoCliente?.id || null,
              telefone: msg.phone,
              status: nextConversationStatus,
              ultimaMensagem: msg.conteudo || `[${String(msg.tipo).toLowerCase()}]`,
              ultimaInteracaoEm: new Date(),
              naoLidas: msg.fromMe ? 0 : 1,
              filaDesde: transition.filaDesde ?? null,
              atendidaEm: transition.atendidaEm ?? null,
            },
            include: {
              Contato: true,
              Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
              Atendente: { select: { id: true, nome: true } },
              Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
            },
          });

          if (transition.evento) {
            await tx.whatsAppConversaEvento.create({
              data: {
                contaId: instance.contaId,
                conversaId: emittedConversation.id,
                tipo: transition.evento,
                usuarioId: emittedConversation.atendenteId ?? null,
                referenciaEm: transition.referenciaEm,
              },
            });
          }

          emittedMessage = await tx.whatsAppMensagem.create({
            data: {
              contaId: instance.contaId,
              conversaId: emittedConversation.id,
              instanciaId: instance.id,
              direcao: msg.fromMe ? WhatsAppMensagemDirecao.SAIDA : WhatsAppMensagemDirecao.ENTRADA,
              tipo: msg.tipo,
              externalMessageId: msg.externalMessageId,
              conteudo: msg.conteudo || null,
              mediaUrl: msg.mediaUrl || null,
              mediaMimeType: msg.mediaMimeType || null,
              fileName: msg.fileName || null,
              quotedMessageId: msg.quotedMessageId || null,
              quotedConteudo: msg.quotedConteudo || null,
              rawPayload: safeJson(payload),
              origem: msg.fromMe ? WhatsAppMensagemOrigem.DISPOSITIVO : WhatsAppMensagemOrigem.CONTATO,
              statusEnvio: msg.fromMe ? WhatsAppMensagemStatus.ENVIADA : WhatsAppMensagemStatus.RECEBIDA,
              enviadoEm: msg.fromMe ? new Date() : null,
            },
          });

          if (!msg.fromMe && !instanceAtendimentoPaused(instance)) {
            agentInput = {
              instance: { id: instance.id, instanceId: instance.instanceId, token: instance.token },
              conversa: {
                id: emittedConversation.id,
                telefone: emittedConversation.telefone,
                status: emittedConversation.status,
                atendenteId: emittedConversation.atendenteId ?? null,
              },
              incoming: { conteudo: msg.conteudo, tipo: msg.tipo },
              incomingMessageId: emittedMessage.id,
              payload,
            };
          }
        }
      }
    }

    await markProcessed(tx, event.id);
    return {
      contaId: instance.contaId,
      instance: emittedInstance,
      conversation: emittedConversation,
      message: emittedMessage,
      agentInput,
    };
  });

  if (result.instance) sendWhatsAppInstanceUpdated(result.contaId, publicInstance(result.instance));
  if (result.conversation) sendWhatsAppConversationUpdated(result.contaId, result.conversation);
  if (result.message) sendWhatsAppMessageCreated(result.contaId, result.message);
  if (result.agentInput) {
    void whatsAppAgentService.handleIncomingForAgent({
      contaId: result.contaId,
      ...result.agentInput,
    }).catch((error) => {
      console.warn(JSON.stringify({
        event: "whatsapp-agent-after-webhook-failed",
        contaId: result.contaId,
        message: String(error?.message || error),
      }));
    });
  }
}
