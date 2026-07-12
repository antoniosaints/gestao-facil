import crypto from "crypto";
import { Prisma, WhatsAppConversaStatus, WhatsAppInstanciaStatus, WhatsAppMensagemDirecao, WhatsAppMensagemStatus, WhatsAppMensagemTipo } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { WApiClient, WApiMessageKind, WApiWebhookUrls, WAPI_WEBHOOK_ENDPOINTS } from "./wApiClient";
import {
  buildDeletedWhatsAppInstanceId,
  buildWApiPaymentPayload,
  canDeleteWhatsAppPayment,
  mapWApiInstanceStatusFromPayload,
  mapWApiPaymentStatus,
} from "./whatsappPolicy";
import {
  sendWhatsAppConversationUpdated,
  sendWhatsAppInstanceUpdated,
  sendWhatsAppMessageCreated,
} from "../../hooks/whatsapp/socket";

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

export type WhatsAppWebhookKind = "received" | "delivery" | "status" | "connected" | "disconnected" | "presence" | "generic";

export interface CreateInstanceInput {
  nome: string;
  instanceId: string;
  token: string;
  ativo?: boolean;
}

export interface UpdateInstanceInput {
  nome?: string;
  instanceId?: string;
  token?: string | null;
  ativo?: boolean;
}

export interface CreateInstancePaymentInput {
  webhookPaymentUrl?: string | null;
}

export interface SendMessageInput {
  tipo?: "text" | "image" | "audio" | "video" | "document";
  conteudo?: string;
  mediaUrl?: string;
  caption?: string;
  fileName?: string;
  extension?: string;
}

export interface ConversationFilters {
  search?: string;
  status?: WhatsAppConversaStatus;
  instanciaId?: number;
  take?: number;
  cursor?: number;
}

function normalizePhone(value?: string | null) {
  if (!value) return "";
  const clean = String(value).replace(/@.*/, "").replace(/\D/g, "");
  return clean.startsWith("55") || clean.length < 11 ? clean : `55${clean}`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function hashPayload(payload: unknown) {
  return crypto.createHash("sha256").update(safeJson(payload)).digest("hex");
}

function publicInstance(instance: any) {
  if (!instance) return instance;
  const { token: _token, webhookSecret: _webhookSecret, pagamentos, ...rest } = instance;
  return {
    ...rest,
    tokenConfigurado: Boolean(instance.token),
    ...(Array.isArray(pagamentos) ? { pagamentos: pagamentos.map(publicPayment) } : {}),
  };
}

function publicPayment(payment: any) {
  if (!payment) return payment;
  const { rawPayload: _rawPayload, ...rest } = payment;
  return rest;
}

function mapMessageStatus(payload: any): WhatsAppMensagemStatus {
  const text = String(payload?.status || payload?.data?.status || payload?.ack || payload?.data?.ack || "").toLowerCase();
  if (["read", "lida", "played", "4"].includes(text) || text.includes("read")) return WhatsAppMensagemStatus.LIDA;
  if (["delivered", "entregue", "3"].includes(text) || text.includes("deliver")) return WhatsAppMensagemStatus.ENTREGUE;
  if (["sent", "enviada", "server_ack", "2"].includes(text) || text.includes("sent")) return WhatsAppMensagemStatus.ENVIADA;
  if (["error", "erro", "failed"].some((term) => text.includes(term))) return WhatsAppMensagemStatus.ERRO;
  return WhatsAppMensagemStatus.PENDENTE;
}

function normalizeMessageType(value?: string | null): WhatsAppMensagemTipo {
  const type = String(value || "").toLowerCase();
  if (type.includes("image") || type.includes("imagem")) return WhatsAppMensagemTipo.IMAGEM;
  if (type.includes("audio") || type.includes("áudio")) return WhatsAppMensagemTipo.AUDIO;
  if (type.includes("video") || type.includes("vídeo")) return WhatsAppMensagemTipo.VIDEO;
  if (type.includes("document") || type.includes("arquivo")) return WhatsAppMensagemTipo.DOCUMENTO;
  if (type.includes("sticker")) return WhatsAppMensagemTipo.STICKER;
  if (type.includes("location")) return WhatsAppMensagemTipo.LOCALIZACAO;
  if (type.includes("contact")) return WhatsAppMensagemTipo.CONTATO;
  if (type.includes("link")) return WhatsAppMensagemTipo.LINK;
  if (!type || type.includes("text") || type.includes("conversation")) return WhatsAppMensagemTipo.TEXTO;
  return WhatsAppMensagemTipo.OUTRO;
}

function extractMessagePayload(payload: any) {
  const data = payload?.data?.message || payload?.message || payload?.data || payload;
  const nestedMessage = data?.message || payload?.message?.message || {};
  const key = data?.key || payload?.key || {};
  const externalMessageId = String(
    data?.messageId || data?.id || key?.id || payload?.messageId || payload?.id || hashPayload(payload),
  );
  const phone = normalizePhone(
    data?.phone ||
      payload?.phone ||
      key?.remoteJid ||
      data?.remoteJid ||
      data?.from ||
      data?.to ||
      payload?.from ||
      payload?.sender,
  );
  const fromMe = Boolean(data?.fromMe ?? key?.fromMe ?? payload?.fromMe ?? payload?.data?.fromMe);
  const text =
    data?.text ||
    data?.body ||
    data?.message ||
    nestedMessage?.conversation ||
    nestedMessage?.extendedTextMessage?.text ||
    nestedMessage?.imageMessage?.caption ||
    nestedMessage?.videoMessage?.caption ||
    nestedMessage?.documentMessage?.caption ||
    payload?.text ||
    payload?.body ||
    "";
  const mediaUrl =
    data?.mediaUrl ||
    data?.url ||
    data?.image ||
    data?.audio ||
    data?.video ||
    data?.document ||
    nestedMessage?.imageMessage?.url ||
    nestedMessage?.audioMessage?.url ||
    nestedMessage?.videoMessage?.url ||
    nestedMessage?.documentMessage?.url ||
    null;
  const rawType = data?.type || data?.messageType || payload?.type || Object.keys(nestedMessage || {})[0] || "text";

  return {
    externalMessageId,
    phone,
    fromMe,
    tipo: normalizeMessageType(rawType),
    conteudo: typeof text === "string" ? text : safeJson(text),
    mediaUrl,
    mediaMimeType: data?.mimeType || nestedMessage?.documentMessage?.mimetype || null,
    fileName: data?.fileName || nestedMessage?.documentMessage?.fileName || null,
    pushName: data?.pushName || data?.senderName || payload?.senderName || null,
  };
}

async function findAutoCliente(contaId: number, phone: string) {
  if (!phone) return null;
  const lastDigits = phone.slice(-8);
  return prisma.clientesFornecedores.findFirst({
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

async function getInstanceById(contaId: number, id: number) {
  const instance = await prisma.whatsAppInstancia.findFirst({ where: { id, contaId } });
  if (!instance) throw new Error("Instância de WhatsApp não encontrada para esta conta");
  return instance;
}

function buildWebhookUrls(instanceId: string, secret: string): Record<keyof WApiWebhookUrls, string> {
  const base = env.BASE_URL.replace(/\/$/, "");
  const url = `${base}/api/whatsapp/webhooks/${encodeURIComponent(instanceId)}?secret=${encodeURIComponent(secret)}`;
  return {
    connected: `${url}&event=connected`,
    disconnected: `${url}&event=disconnected`,
    delivery: `${url}&event=delivery`,
    received: `${url}&event=received`,
    status: `${url}&event=status`,
    presence: `${url}&event=presence`,
  };
}

function buildWebhookPreview(instanceId: string, secret: string) {
  const webhookUrls = buildWebhookUrls(instanceId, secret);
  return {
    webhookUrls,
    callbacks: WAPI_WEBHOOK_ENDPOINTS.map((item) => ({
      key: item.key,
      label: item.label,
      endpoint: item.endpoint,
      url: webhookUrls[item.key],
    })),
  };
}

function buildPaymentWebhookUrl(instanceId: string, secret: string) {
  const base = env.BASE_URL.replace(/\/$/, "");
  return `${base}/api/whatsapp/payments/webhooks/${encodeURIComponent(instanceId)}?secret=${encodeURIComponent(secret)}`;
}

async function getContaEmail(contaId: number) {
  const conta = await prisma.contas.findUnique({
    where: { id: contaId },
    select: { email: true },
  });

  if (!conta?.email) {
    throw new Error("E-mail da conta nao encontrado para gerar pagamento WhatsApp");
  }

  return conta.email;
}

function extractPaymentIdentifier(payload: any, key: "paymentId" | "sessionId") {
  const value =
    payload?.[key] ||
    payload?.data?.[key] ||
    payload?.payment?.[key] ||
    payload?.subscription?.[key];

  return value === undefined || value === null ? null : String(value);
}

function assertWApiPaymentCreated(result: any, fallbackMessage: string) {
  if (result?.error === true || result?.data?.error === true) {
    throw new Error(result?.message || result?.data?.message || fallbackMessage);
  }
}

export const whatsAppService = {
  normalizePhone,

  async listInstances(contaId: number) {
    const instances = await prisma.whatsAppInstancia.findMany({
      where: { contaId, ativo: true },
      include: {
        pagamentos: {
          orderBy: { createdAt: "desc" },
          take: 8,
        },
      },
      orderBy: [{ ativo: "desc" }, { updatedAt: "desc" }],
    });
    return instances.map(publicInstance);
  },

  async createInstance(contaId: number, input: CreateInstanceInput) {
    const instance = await prisma.whatsAppInstancia.create({
      data: {
        contaId,
        nome: input.nome.trim(),
        instanceId: input.instanceId.trim(),
        token: input.token.trim(),
        ativo: input.ativo ?? true,
        webhookSecret: crypto.randomBytes(32).toString("hex"),
      },
    });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicInstance(instance);
  },

  async updateInstance(contaId: number, id: number, input: UpdateInstanceInput) {
    await getInstanceById(contaId, id);
    const data: Prisma.WhatsAppInstanciaUpdateInput = {};
    if (typeof input.nome === "string") data.nome = input.nome.trim();
    if (typeof input.instanceId === "string") data.instanceId = input.instanceId.trim();
    if (typeof input.ativo === "boolean") data.ativo = input.ativo;
    if (typeof input.token === "string" && input.token.trim()) data.token = input.token.trim();

    const instance = await prisma.whatsAppInstancia.update({ where: { id }, data });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicInstance(instance);
  },

  async removeInstance(contaId: number, id: number) {
    const instance = await getInstanceById(contaId, id);

    const updated = await prisma.whatsAppInstancia.update({
      where: { id },
      data: {
        ativo: false,
        status: WhatsAppInstanciaStatus.DESCONECTADA,
        instanceId: buildDeletedWhatsAppInstanceId(instance.instanceId, id),
        token: "",
        ultimoErro: null,
        lastSyncAt: new Date(),
      },
    });

    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));
    return publicInstance(updated);
  },

  async removePayment(contaId: number, instanceId: number, paymentId: number) {
    await getInstanceById(contaId, instanceId);
    const payment = await prisma.whatsAppInstanciaPagamento.findFirst({
      where: {
        id: paymentId,
        contaId,
        instanciaId: instanceId,
      },
    });

    if (!payment) {
      throw new Error("Pagamento WhatsApp nao encontrado para esta instancia.");
    }

    if (!canDeleteWhatsAppPayment(payment)) {
      throw new Error("Apenas pagamentos pendentes podem ser apagados.");
    }

    const deleted = await prisma.whatsAppInstanciaPagamento.delete({
      where: {
        id: payment.id,
      },
    });

    const instance = await getInstanceById(contaId, instanceId);
    sendWhatsAppInstanceUpdated(contaId, publicInstance(instance));
    return publicPayment(deleted);
  },

  async getInstance(contaId: number, id: number) {
    return publicInstance(await getInstanceById(contaId, id));
  },

  async getInstanceWebhookPreview(contaId: number, id: number) {
    const instance = await getInstanceById(contaId, id);
    return {
      instance: publicInstance(instance),
      ...buildWebhookPreview(instance.instanceId, instance.webhookSecret),
    };
  },

  async configureInstanceWebhooks(contaId: number, id: number, webhookUrls?: WApiWebhookUrls) {
    const instance = await getInstanceById(contaId, id);
    const urls = webhookUrls && Object.keys(webhookUrls).length ? webhookUrls : buildWebhookUrls(instance.instanceId, instance.webhookSecret);
    const client = new WApiClient(instance.instanceId, instance.token);
    const results = await client.configureWebhooks(urls);
    const hasFailures = results.some((result) => !result.ok && !result.skipped);

    const updated = await prisma.whatsAppInstancia.update({
      where: { id },
      data: {
        lastSyncAt: new Date(),
        ultimoErro: hasFailures ? "Uma ou mais URLs de webhook falharam ao sincronizar com a W-API" : null,
      },
    });

    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));

    return {
      instance: publicInstance(updated),
      webhookUrls: urls,
      callbacks: WAPI_WEBHOOK_ENDPOINTS.map((item) => ({
        key: item.key,
        label: item.label,
        endpoint: item.endpoint,
        url: urls[item.key],
      })),
      results,
      success: !hasFailures,
    };
  },

  async callInstanceAction(contaId: number, id: number, action: "qrCode" | "pairingCode" | "restart" | "disconnect" | "status" | "device" | "setupWebhooks", phone?: string) {
    const instance = await getInstanceById(contaId, id);
    if (action === "setupWebhooks") return this.configureInstanceWebhooks(contaId, id);

    const client = new WApiClient(instance.instanceId, instance.token);
    let result: any;

    if (action === "qrCode") result = await client.qrCode();
    if (action === "pairingCode") result = await client.pairingCode(phone || instance.numeroConectado || undefined);
    if (action === "restart") result = await client.restart();
    if (action === "disconnect") result = await client.disconnect();
    if (action === "status") result = await client.status();
    if (action === "device") result = await client.device();

    const data: Prisma.WhatsAppInstanciaUpdateInput = {
      lastSyncAt: new Date(),
      ultimoErro: null,
    };

    if (["status", "device", "qrCode", "pairingCode", "restart", "disconnect"].includes(action)) {
      data.status = action === "disconnect" ? WhatsAppInstanciaStatus.DESCONECTADA : mapWApiInstanceStatusFromPayload(result);
      if (action === "device") {
        data.devicePayload = safeJson(result);
        data.numeroConectado = normalizePhone(result?.phone || result?.number || result?.data?.phone || result?.data?.number) || instance.numeroConectado;
      }
    }

    const updated = await prisma.whatsAppInstancia.update({ where: { id }, data });
    sendWhatsAppInstanceUpdated(contaId, publicInstance(updated));
    return { result, instance: publicInstance(updated) };
  },

  async createPixPayment(
    contaId: number,
    id: number,
    input: CreateInstancePaymentInput = {}
  ) {
    const instance = await getInstanceById(contaId, id);
    const payerEmail = await getContaEmail(contaId);
    const webhookPaymentUrl =
      input.webhookPaymentUrl || buildPaymentWebhookUrl(instance.instanceId, instance.webhookSecret);
    const payload = buildWApiPaymentPayload(payerEmail, webhookPaymentUrl);
    const result = await new WApiClient(instance.instanceId, instance.token).createPixPayment(payload);
    assertWApiPaymentCreated(result, "Falha ao gerar cobranca PIX na W-API");
    const status = mapWApiPaymentStatus(result);

    const payment = await prisma.whatsAppInstanciaPagamento.create({
      data: {
        contaId,
        instanciaId: instance.id,
        metodo: "PIX",
        status,
        payerEmail,
        webhookPaymentUrl,
        paymentId: extractPaymentIdentifier(result, "paymentId"),
        qrCodeBase64: result?.qrCodeBase64 || result?.data?.qrCodeBase64 || null,
        qrCodeCopyPaste: result?.qrCodeCopyPaste || result?.data?.qrCodeCopyPaste || null,
        ticketUrl: result?.ticketUrl || result?.data?.ticketUrl || null,
        rawPayload: safeJson(result),
        pagoEm: status === "PAGO" ? new Date() : null,
      },
    });

    return publicPayment(payment);
  },

  async createCardSubscription(
    contaId: number,
    id: number,
    input: CreateInstancePaymentInput = {}
  ) {
    const instance = await getInstanceById(contaId, id);
    const payerEmail = await getContaEmail(contaId);
    const webhookPaymentUrl =
      input.webhookPaymentUrl || buildPaymentWebhookUrl(instance.instanceId, instance.webhookSecret);
    const payload = buildWApiPaymentPayload(payerEmail, webhookPaymentUrl);
    const result = await new WApiClient(instance.instanceId, instance.token).createCardSubscription(payload);
    assertWApiPaymentCreated(result, "Falha ao gerar checkout de cartao na W-API");
    const status = mapWApiPaymentStatus(result);

    const payment = await prisma.whatsAppInstanciaPagamento.create({
      data: {
        contaId,
        instanciaId: instance.id,
        metodo: "CARTAO",
        status,
        payerEmail,
        webhookPaymentUrl,
        sessionId: extractPaymentIdentifier(result, "sessionId"),
        checkoutUrl: result?.checkoutUrl || result?.data?.checkoutUrl || null,
        rawPayload: safeJson(result),
        pagoEm: status === "PAGO" ? new Date() : null,
      },
    });

    return publicPayment(payment);
  },

  async processPaymentWebhook(
    instanceId: string,
    receivedSecret: string | undefined,
    payload: any
  ) {
    const instance = await prisma.whatsAppInstancia.findUnique({ where: { instanceId } });
    if (!instance) {
      const error = new Error("Instancia de pagamento WhatsApp invalida");
      (error as any).statusCode = 404;
      throw error;
    }

    if (!receivedSecret || receivedSecret !== instance.webhookSecret) {
      const error = new Error("Assinatura de webhook de pagamento invalida");
      (error as any).statusCode = 403;
      throw error;
    }

    const paymentId = extractPaymentIdentifier(payload, "paymentId");
    const sessionId = extractPaymentIdentifier(payload, "sessionId");
    const status = mapWApiPaymentStatus(payload);
    const identifiers = [
      ...(paymentId ? [{ paymentId }] : []),
      ...(sessionId ? [{ sessionId }] : []),
    ];

    const payment = await prisma.whatsAppInstanciaPagamento.findFirst({
      where: {
        contaId: instance.contaId,
        instanciaId: instance.id,
        ...(identifiers.length ? { OR: identifiers } : { status: "PENDENTE" }),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!payment) {
      return { updated: false, status };
    }

    const updated = await prisma.whatsAppInstanciaPagamento.update({
      where: { id: payment.id },
      data: {
        status,
        paymentId: paymentId || payment.paymentId,
        sessionId: sessionId || payment.sessionId,
        rawPayload: safeJson(payload),
        pagoEm: status === "PAGO" ? new Date() : payment.pagoEm,
      },
    });

    sendWhatsAppInstanceUpdated(instance.contaId, publicInstance(instance));
    return { updated: true, payment: publicPayment(updated), status };
  },

  async listConversations(contaId: number, filters: ConversationFilters) {
    const take = Math.min(Math.max(Number(filters.take || DEFAULT_TAKE), 1), MAX_TAKE);
    const search = filters.search?.trim();
    const where: Prisma.WhatsAppConversaWhereInput = {
      contaId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.instanciaId ? { instanciaId: filters.instanciaId } : {}),
      ...(search
        ? {
            OR: [
              { telefone: { contains: normalizePhone(search) || search } },
              { Contato: { nome: { contains: search } } },
              { Cliente: { nome: { contains: search } } },
            ],
          }
        : {}),
    };

    const items = await prisma.whatsAppConversa.findMany({
      where,
      take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: [{ ultimaInteracaoEm: "desc" }, { updatedAt: "desc" }],
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });

    const hasMore = items.length > take;
    const sliced = hasMore ? items.slice(0, take) : items;
    return { items: sliced, nextCursor: hasMore ? sliced[sliced.length - 1]?.id : null };
  },

  async listMessages(contaId: number, conversaId: number, take = DEFAULT_TAKE, cursor?: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    const limit = Math.min(Math.max(Number(take || DEFAULT_TAKE), 1), MAX_TAKE);
    const items = await prisma.whatsAppMensagem.findMany({
      where: { contaId, conversaId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
    });
    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return { items: sliced.reverse(), nextCursor: hasMore ? sliced[sliced.length - 1]?.id : null };
  },

  async sendMessage(contaId: number, conversaId: number, input: SendMessageInput) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");
    if (!conversa.Instancia.ativo) throw new Error("Instância inativa para envio de mensagens");
    if (conversa.Instancia.status !== WhatsAppInstanciaStatus.CONECTADA) throw new Error("Instância desconectada. Reconecte antes de enviar mensagens.");

    const messageId = `erp-${contaId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const tipo = input.tipo || "text";
    const prismaTipo = normalizeMessageType(tipo);

    const pending = await prisma.whatsAppMensagem.create({
      data: {
        contaId,
        conversaId,
        instanciaId: conversa.instanciaId,
        direcao: WhatsAppMensagemDirecao.SAIDA,
        tipo: prismaTipo,
        externalMessageId: messageId,
        conteudo: input.conteudo || input.caption || null,
        mediaUrl: input.mediaUrl || null,
        fileName: input.fileName || null,
        statusEnvio: WhatsAppMensagemStatus.PENDENTE,
      },
    });
    sendWhatsAppMessageCreated(contaId, pending);

    try {
      const client = new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token);
      const result = await client.send(tipo as WApiMessageKind, {
        phone: conversa.telefone,
        message: input.conteudo,
        mediaUrl: input.mediaUrl,
        caption: input.caption,
        fileName: input.fileName,
        extension: input.extension,
        messageId,
      });

      const updated = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          rawPayload: safeJson(result),
          statusEnvio: WhatsAppMensagemStatus.ENVIADA,
          enviadoEm: new Date(),
        },
      });

      const updatedConversation = await prisma.whatsAppConversa.update({
        where: { id: conversa.id },
        data: {
          ultimaMensagem: input.conteudo || input.caption || `[${prismaTipo.toLowerCase()}]`,
          ultimaInteracaoEm: new Date(),
          status: conversa.status === WhatsAppConversaStatus.FINALIZADA ? WhatsAppConversaStatus.ABERTA : conversa.status,
        },
      });
      sendWhatsAppMessageCreated(contaId, updated);
      sendWhatsAppConversationUpdated(contaId, updatedConversation);
      return updated;
    } catch (error: any) {
      const failed = await prisma.whatsAppMensagem.update({
        where: { id: pending.id },
        data: {
          statusEnvio: WhatsAppMensagemStatus.ERRO,
          erroEnvio: error?.response?.data ? safeJson(error.response.data) : error?.message || "Erro no envio pela W-API",
        },
      });
      sendWhatsAppMessageCreated(contaId, failed);
      throw error;
    }
  },

  async updateConversation(contaId: number, conversaId: number, input: { status?: WhatsAppConversaStatus; atendenteId?: number | null; setor?: string | null; fila?: string | null; clienteId?: number | null }) {
    const conversa = await prisma.whatsAppConversa.findFirst({ where: { id: conversaId, contaId } });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    if (input.atendenteId) {
      const user = await prisma.usuarios.findFirst({ where: { id: input.atendenteId, contaId } });
      if (!user) throw new Error("Atendente não encontrado para esta conta");
    }

    if (input.clienteId) {
      const cliente = await prisma.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId } });
      if (!cliente) throw new Error("Cliente não encontrado para esta conta");
      await prisma.whatsAppContato.update({ where: { id: conversa.contatoId }, data: { clienteId: input.clienteId } });
    }

    const updated = await prisma.whatsAppConversa.update({
      where: { id: conversaId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...("atendenteId" in input ? { atendenteId: input.atendenteId } : {}),
        ...("setor" in input ? { setor: input.setor } : {}),
        ...("fila" in input ? { fila: input.fila } : {}),
        ...("clienteId" in input ? { clienteId: input.clienteId } : {}),
      },
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });
    sendWhatsAppConversationUpdated(contaId, updated);
    return updated;
  },

  async markAsRead(contaId: number, conversaId: number) {
    const conversa = await prisma.whatsAppConversa.findFirst({
      where: { id: conversaId, contaId },
      include: { Instancia: true },
    });
    if (!conversa) throw new Error("Conversa não encontrada para esta conta");

    await prisma.whatsAppMensagem.updateMany({
      where: { contaId, conversaId, direcao: WhatsAppMensagemDirecao.ENTRADA, lidoEm: null },
      data: { lidoEm: new Date(), statusEnvio: WhatsAppMensagemStatus.LIDA },
    });
    const updated = await prisma.whatsAppConversa.update({ where: { id: conversaId }, data: { naoLidas: 0 } });

    try {
      const lastUnread = await prisma.whatsAppMensagem.findFirst({
        where: { contaId, conversaId, direcao: WhatsAppMensagemDirecao.ENTRADA },
        orderBy: { createdAt: "desc" },
      });
      if (lastUnread) {
        await new WApiClient(conversa.Instancia.instanceId, conversa.Instancia.token).readMessage(conversa.telefone, lastUnread.externalMessageId);
      }
    } catch (error) {
      console.warn(`[whatsapp] Falha ao sinalizar leitura na W-API conversa=${conversaId}`, error);
    }

    sendWhatsAppConversationUpdated(contaId, updated);
    return updated;
  },

  async startConversation(contaId: number, input: { clienteId: number; instanciaId?: number }) {
    const cliente = await prisma.clientesFornecedores.findFirst({
      where: { id: input.clienteId, contaId },
      select: { id: true, nome: true, telefone: true, whastapp: true },
    });
    if (!cliente) throw new Error("Cliente não encontrado para esta conta");

    const phone = normalizePhone(cliente.whastapp || cliente.telefone);
    if (!phone) throw new Error("Cliente não possui telefone/WhatsApp cadastrado para iniciar o atendimento");

    let instance;
    if (input.instanciaId) {
      instance = await prisma.whatsAppInstancia.findFirst({ where: { id: input.instanciaId, contaId, ativo: true } });
      if (!instance) throw new Error("Instância de WhatsApp não encontrada para esta conta");
    } else {
      instance =
        (await prisma.whatsAppInstancia.findFirst({
          where: { contaId, ativo: true, status: WhatsAppInstanciaStatus.CONECTADA },
          orderBy: { updatedAt: "desc" },
        })) ||
        (await prisma.whatsAppInstancia.findFirst({
          where: { contaId, ativo: true },
          orderBy: { updatedAt: "desc" },
        }));
      if (!instance) throw new Error("Nenhuma instância de WhatsApp ativa. Conecte uma instância no app WhatsApp antes de iniciar o atendimento.");
    }

    const contato = await prisma.whatsAppContato.upsert({
      where: { contaId_telefone: { contaId, telefone: phone } },
      update: { nome: cliente.nome || undefined, clienteId: cliente.id },
      create: {
        contaId,
        telefone: phone,
        nome: cliente.nome || null,
        clienteId: cliente.id,
        dadosAuxiliares: safeJson({ createdBy: "atendimento-start" }),
      },
    });

    const conversa = await prisma.whatsAppConversa.upsert({
      where: {
        contaId_instanciaId_telefone: { contaId, instanciaId: instance.id, telefone: phone },
      },
      update: {
        contatoId: contato.id,
        clienteId: cliente.id,
        status: WhatsAppConversaStatus.ABERTA,
      },
      create: {
        contaId,
        instanciaId: instance.id,
        contatoId: contato.id,
        clienteId: cliente.id,
        telefone: phone,
        status: WhatsAppConversaStatus.ABERTA,
        ultimaInteracaoEm: new Date(),
        naoLidas: 0,
      },
      include: {
        Contato: true,
        Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
        Atendente: { select: { id: true, nome: true } },
        Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
      },
    });

    sendWhatsAppConversationUpdated(contaId, conversa);
    return conversa;
  },

  async processWebhook(instanceId: string, receivedSecret: string | undefined, explicitKind: WhatsAppWebhookKind, payload: any) {
    const instance = await prisma.whatsAppInstancia.findUnique({ where: { instanceId } });
    if (!instance || !instance.ativo) {
      const error = new Error("Instância de webhook inválida ou inativa");
      (error as any).statusCode = 404;
      throw error;
    }

    if (!receivedSecret || receivedSecret !== instance.webhookSecret) {
      const error = new Error("Assinatura de webhook inválida");
      (error as any).statusCode = 403;
      throw error;
    }

    const eventId = String(payload?.eventId || payload?.id || payload?.data?.id || payload?.messageId || payload?.data?.messageId || hashPayload(payload));
    const tipo = String(explicitKind || payload?.event || payload?.type || payload?.eventName || "generic");

    let event = await prisma.whatsAppWebhookEvento.findUnique({
      where: { instanciaId_eventId: { instanciaId: instance.id, eventId } },
    });

    if (event?.processado) {
      return { duplicated: true, event };
    }

    if (!event) {
      event = await prisma.whatsAppWebhookEvento.create({
        data: {
          contaId: instance.contaId,
          instanciaId: instance.id,
          eventId,
          tipo,
          payload: safeJson(payload),
        },
      });
    }

    try {
      if (["connected", "disconnected", "status", "presence"].includes(tipo)) {
        const status = tipo === "connected" ? WhatsAppInstanciaStatus.CONECTADA : tipo === "disconnected" ? WhatsAppInstanciaStatus.DESCONECTADA : mapWApiInstanceStatusFromPayload(payload);
        const updatedInstance = await prisma.whatsAppInstancia.update({
          where: { id: instance.id },
          data: { status, lastSyncAt: new Date(), ultimoErro: null },
        });
        sendWhatsAppInstanceUpdated(instance.contaId, publicInstance(updatedInstance));
      }

      if (["received", "delivery"].includes(tipo) || payload?.message || payload?.data?.message || payload?.data?.messageId) {
        if (tipo === "delivery" || payload?.status || payload?.data?.status || payload?.ack || payload?.data?.ack) {
          const messageId = String(payload?.messageId || payload?.data?.messageId || payload?.id || payload?.data?.id || "");
          if (messageId) {
            await prisma.whatsAppMensagem.updateMany({
              where: { contaId: instance.contaId, instanciaId: instance.id, externalMessageId: messageId },
              data: { statusEnvio: mapMessageStatus(payload), ...(mapMessageStatus(payload) === WhatsAppMensagemStatus.LIDA ? { lidoEm: new Date() } : {}) },
            });
          }
        }

        if (tipo !== "delivery") {
          const msg = extractMessagePayload(payload);
          if (msg.phone) {
            const autoCliente = await findAutoCliente(instance.contaId, msg.phone);
            const contato = await prisma.whatsAppContato.upsert({
              where: { contaId_telefone: { contaId: instance.contaId, telefone: msg.phone } },
              update: {
                nome: msg.pushName || undefined,
                clienteId: autoCliente?.id || undefined,
                dadosAuxiliares: safeJson({ lastWebhookAt: new Date().toISOString() }),
              },
              create: {
                contaId: instance.contaId,
                telefone: msg.phone,
                nome: msg.pushName || null,
                clienteId: autoCliente?.id || null,
                dadosAuxiliares: safeJson({ createdBy: "whatsapp-webhook" }),
              },
            });

            const conversa = await prisma.whatsAppConversa.upsert({
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
                status: WhatsAppConversaStatus.ABERTA,
                ultimaMensagem: msg.conteudo || `[${msg.tipo.toLowerCase()}]`,
                ultimaInteracaoEm: new Date(),
                ...(msg.fromMe ? {} : { naoLidas: { increment: 1 } }),
              },
              create: {
                contaId: instance.contaId,
                instanciaId: instance.id,
                contatoId: contato.id,
                clienteId: contato.clienteId || autoCliente?.id || null,
                telefone: msg.phone,
                status: WhatsAppConversaStatus.ABERTA,
                ultimaMensagem: msg.conteudo || `[${msg.tipo.toLowerCase()}]`,
                ultimaInteracaoEm: new Date(),
                naoLidas: msg.fromMe ? 0 : 1,
              },
              include: {
                Contato: true,
                Cliente: { select: { id: true, nome: true, telefone: true, whastapp: true } },
                Atendente: { select: { id: true, nome: true } },
                Instancia: { select: { id: true, nome: true, status: true, numeroConectado: true } },
              },
            });

            const message = await prisma.whatsAppMensagem.upsert({
              where: {
                contaId_instanciaId_externalMessageId: {
                  contaId: instance.contaId,
                  instanciaId: instance.id,
                  externalMessageId: msg.externalMessageId,
                },
              },
              update: { rawPayload: safeJson(payload) },
              create: {
                contaId: instance.contaId,
                conversaId: conversa.id,
                instanciaId: instance.id,
                direcao: msg.fromMe ? WhatsAppMensagemDirecao.SAIDA : WhatsAppMensagemDirecao.ENTRADA,
                tipo: msg.tipo,
                externalMessageId: msg.externalMessageId,
                conteudo: msg.conteudo || null,
                mediaUrl: msg.mediaUrl || null,
                mediaMimeType: msg.mediaMimeType || null,
                fileName: msg.fileName || null,
                rawPayload: safeJson(payload),
                statusEnvio: msg.fromMe ? WhatsAppMensagemStatus.ENVIADA : WhatsAppMensagemStatus.RECEBIDA,
                enviadoEm: msg.fromMe ? new Date() : null,
              },
            });

            sendWhatsAppConversationUpdated(instance.contaId, conversa);
            sendWhatsAppMessageCreated(instance.contaId, message);
          }
        }
      }

      const processed = await prisma.whatsAppWebhookEvento.update({
        where: { id: event.id },
        data: { processado: true, processedAt: new Date(), erro: null },
      });
      return { duplicated: false, event: processed };
    } catch (error: any) {
      await prisma.whatsAppWebhookEvento.update({
        where: { id: event.id },
        data: { erro: error?.message || "Erro ao processar webhook" },
      });
      await prisma.whatsAppInstancia.update({
        where: { id: instance.id },
        data: { ultimoErro: error?.message || "Erro ao processar webhook", lastSyncAt: new Date() },
      });
      throw error;
    }
  },
};
