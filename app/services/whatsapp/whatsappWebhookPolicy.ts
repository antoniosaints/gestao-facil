import crypto from "node:crypto";
import type { WhatsAppWebhookKind } from "./whatsappService";

type JsonRecord = Record<string, any>;

export type WebhookStorageDecision =
  | { persist: true }
  | { persist: false; reason: "evento-nao-relevante" | "grupo-nao-suportado" | "status-nao-suportado" | "canal-nao-suportado" | "mensagem-sem-chat" | "delivery-sem-message-id" };

const MAX_TEXT_LENGTH = 65_535;
const MAX_METADATA_LENGTH = 8_192;
const MAX_URL_LENGTH = 4_096;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function isObject(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maxLength = MAX_METADATA_LENGTH): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  return String(value).slice(0, maxLength);
}

function defined<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as T;
}

function compactContextInfo(value: unknown, depth = 0): JsonRecord | undefined {
  if (!isObject(value)) return undefined;
  const source = object(value);
  const quotedMessage = depth < 1 ? compactMessageContent(source.quotedMessage, depth + 1) : {};
  const result = defined({
    stanzaID: text(source.stanzaID),
    stanzaId: text(source.stanzaId),
    quotedMessage: Object.keys(quotedMessage).length ? quotedMessage : undefined,
  });
  return Object.keys(result).length ? result : undefined;
}

function compactMedia(value: unknown, depth = 0): JsonRecord {
  const source = object(value);
  return defined({
    caption: text(source.caption, MAX_TEXT_LENGTH),
    URL: text(source.URL, MAX_URL_LENGTH),
    url: text(source.url, MAX_URL_LENGTH),
    mediaUrl: text(source.mediaUrl, MAX_URL_LENGTH),
    link: text(source.link, MAX_URL_LENGTH),
    directPath: text(source.directPath, MAX_URL_LENGTH),
    mimetype: text(source.mimetype),
    mimeType: text(source.mimeType),
    mediaKey: text(source.mediaKey),
    fileName: text(source.fileName),
    filename: text(source.filename),
    title: text(source.title),
    fileLength: text(source.fileLength),
    fileSize: text(source.fileSize),
    size: text(source.size),
    contextInfo: compactContextInfo(source.contextInfo, depth),
  });
}

/**
 * Mantém o subconjunto do conteúdo da mensagem que é consumido pelo atendimento:
 * exibição, citação, download de mídia, revogação e reações. Nunca persiste blobs,
 * thumbnails ou metadados de grupo que não têm utilidade depois do processamento.
 */
function compactMessageContent(value: unknown, depth = 0): JsonRecord {
  if (!isObject(value)) return {};
  const source = object(value);
  return defined({
    conversation: text(source.conversation, MAX_TEXT_LENGTH),
    extendedTextMessage: (() => {
      const item = object(source.extendedTextMessage);
      const result = defined({ text: text(item.text, MAX_TEXT_LENGTH), contextInfo: compactContextInfo(item.contextInfo, depth) });
      return Object.keys(result).length ? result : undefined;
    })(),
    imageMessage: (() => {
      const result = compactMedia(source.imageMessage, depth);
      return Object.keys(result).length ? result : undefined;
    })(),
    stickerMessage: (() => {
      const result = compactMedia(source.stickerMessage, depth);
      return Object.keys(result).length ? result : undefined;
    })(),
    audioMessage: (() => {
      const result = compactMedia(source.audioMessage, depth);
      return Object.keys(result).length ? result : undefined;
    })(),
    videoMessage: (() => {
      const result = compactMedia(source.videoMessage, depth);
      return Object.keys(result).length ? result : undefined;
    })(),
    documentMessage: (() => {
      const result = compactMedia(source.documentMessage, depth);
      return Object.keys(result).length ? result : undefined;
    })(),
    locationMessage: (() => {
      const item = object(source.locationMessage);
      const result = defined({
        degreesLatitude: text(item.degreesLatitude),
        degreesLongitude: text(item.degreesLongitude),
        name: text(item.name),
        address: text(item.address),
        contextInfo: compactContextInfo(item.contextInfo, depth),
      });
      return Object.keys(result).length ? result : undefined;
    })(),
    contactMessage: (() => {
      const item = object(source.contactMessage);
      const result = defined({
        displayName: text(item.displayName),
        vcard: text(item.vcard, MAX_TEXT_LENGTH),
        phone: text(item.phone),
        businessDescription: text(item.businessDescription),
        contextInfo: compactContextInfo(item.contextInfo, depth),
      });
      return Object.keys(result).length ? result : undefined;
    })(),
    protocolMessage: (() => {
      if (!isObject(source.protocolMessage)) return undefined;
      const item = object(source.protocolMessage);
      const key = defined({ ID: text(object(item.key).ID), id: text(object(item.key).id) });
      const result = defined({
        type: text(item.type),
        key: Object.keys(key).length ? key : undefined,
      });
      return Object.keys(result).length ? result : undefined;
    })(),
    reactionMessage: (() => {
      if (!isObject(source.reactionMessage)) return undefined;
      const item = object(source.reactionMessage);
      const key = defined({
        ID: text(object(item.key).ID),
        id: text(object(item.key).id),
        fromMe: typeof object(item.key).fromMe === "boolean" ? object(item.key).fromMe : undefined,
      });
      const result = defined({
        text: text(item.text),
        key: Object.keys(key).length ? key : undefined,
      });
      return Object.keys(result).length ? result : undefined;
    })(),
  });
}

function webhookMessageContent(payload: any): JsonRecord {
  const source = object(payload);
  const data = object(source.data);
  const message = object(source.message);
  // `data` também é usado em callbacks de conexão/status. Só o consideramos mensagem
  // quando ele traz explicitamente o envelope `message`; caso contrário um `connected`
  // poderia ser confundido com conteúdo de chat e descartado por não ter telefone.
  return object(source.msgContent || data.message || message.message || message);
}

function webhookChatId(payload: any): string {
  const source = object(payload);
  const data = object(source.data);
  const chat = object(source.chat || data.chat);
  const key = object(source.key || data.key);
  return String(chat.id || key.remoteJid || "");
}

function webhookHasMessage(payload: any): boolean {
  return Object.keys(webhookMessageContent(payload)).length > 0;
}

function webhookMessageId(payload: any): string {
  const source = object(payload);
  const data = object(source.data);
  return String(source.messageId || data.messageId || source.id || data.id || "");
}

export function shouldPersistWebhookEvent(tipo: string, payload: any): WebhookStorageDecision {
  // Presença (digitando/online) não altera nenhuma entidade do atendimento e era o maior
  // produtor de eventos sem valor operacional.
  if (tipo === "presence") return { persist: false, reason: "evento-nao-relevante" };

  const source = object(payload);
  const chatId = webhookChatId(source);
  const sender = object(source.sender || object(source.data).sender);
  const fromMe = Boolean(source.fromMe ?? object(source.key || object(source.data).key).fromMe ?? object(source.data).fromMe);
  const hasMessage = webhookHasMessage(source);
  const isGroup = Boolean(source.isGroup) || chatId.endsWith("@g.us");
  const isStatusBroadcast = chatId === "status" || chatId.startsWith("status@");
  const isChannel = chatId.endsWith("@newsletter") || Boolean(source.isChannel) || (hasMessage && !fromMe && !String(sender.id || "").trim());

  if (isGroup) return { persist: false, reason: "grupo-nao-suportado" };
  if (isStatusBroadcast) return { persist: false, reason: "status-nao-suportado" };
  if (isChannel) return { persist: false, reason: "canal-nao-suportado" };

  const hasChatTarget = Boolean(chatId || sender.id || source.phone || source.from);
  if (hasMessage) {
    if (!hasChatTarget) return { persist: false, reason: "mensagem-sem-chat" };
    return { persist: true };
  }
  if (tipo === "delivery" || tipo === "status") {
    return webhookMessageId(source) ? { persist: true } : { persist: false, reason: "delivery-sem-message-id" };
  }
  if (tipo === "connected" || tipo === "disconnected") return { persist: true };
  return { persist: false, reason: "evento-nao-relevante" };
}

/** Retorna um envelope compatível com o processador, sem o payload integral da W-API. */
export function compactWebhookPayload(payload: any): JsonRecord {
  const source = object(payload);
  const data = object(source.data);
  const sender = object(source.sender || data.sender);
  const chat = object(source.chat || data.chat);
  const key = object(source.key || data.key);
  const content = compactMessageContent(webhookMessageContent(source));
  const compactSender = defined({ id: text(sender.id), pushName: text(sender.pushName), profilePicture: text(sender.profilePicture, MAX_URL_LENGTH) });
  const compactChat = defined({ id: text(chat.id), profilePicture: text(chat.profilePicture, MAX_URL_LENGTH) });
  const compactKey = defined({ id: text(key.id), ID: text(key.ID), fromMe: typeof key.fromMe === "boolean" ? key.fromMe : undefined, remoteJid: text(key.remoteJid) });

  return defined({
    eventId: text(source.eventId),
    id: text(source.id || data.id),
    messageId: text(source.messageId || data.messageId),
    type: text(source.type),
    event: text(source.event),
    fromMe: typeof (source.fromMe ?? key.fromMe ?? data.fromMe) === "boolean" ? Boolean(source.fromMe ?? key.fromMe ?? data.fromMe) : undefined,
    status: text(source.status || data.status),
    ack: text(source.ack || data.ack),
    connected: typeof (source.connected ?? data.connected) === "boolean" ? Boolean(source.connected ?? data.connected) : undefined,
    state: text(source.state || data.state),
    sender: Object.keys(compactSender).length ? compactSender : undefined,
    chat: Object.keys(compactChat).length ? compactChat : undefined,
    key: Object.keys(compactKey).length ? compactKey : undefined,
    msgContent: Object.keys(content).length ? content : undefined,
  });
}

function serialize(value: unknown) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

export function resolveWebhookIdentity(explicitKind: WhatsAppWebhookKind, payload: any) {
  const eventId = String(
    payload?.eventId ||
    payload?.id ||
    payload?.data?.id ||
    payload?.messageId ||
    payload?.data?.messageId ||
    crypto.createHash("sha256").update(serialize(payload)).digest("hex"),
  );
  const tipo = String(explicitKind || payload?.event || payload?.type || payload?.eventName || "generic");
  return { eventId, tipo };
}

const RETRY_DELAYS_MS = [
  5_000,
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export function webhookRetryDelayMs(attempt: number) {
  const index = Math.min(Math.max(Math.trunc(attempt) - 1, 0), RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}
