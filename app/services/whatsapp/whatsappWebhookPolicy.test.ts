import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactWebhookPayload,
  resolveWebhookIdentity,
  shouldPersistWebhookEvent,
  webhookRetryDelayMs,
} from "./whatsappWebhookPolicy";

describe("whatsappWebhookPolicy", () => {
  it("mantém o id externo e separa eventos do mesmo id pelo tipo", () => {
    const payload = { messageId: "message-42" };
    assert.deepEqual(resolveWebhookIdentity("received", payload), {
      eventId: "message-42",
      tipo: "received",
    });
    assert.deepEqual(resolveWebhookIdentity("delivery", payload), {
      eventId: "message-42",
      tipo: "delivery",
    });
  });

  it("gera hash estável quando o provedor não envia identificador", () => {
    const first = resolveWebhookIdentity("presence", { value: "online" });
    const second = resolveWebhookIdentity("presence", { value: "online" });
    assert.equal(first.eventId, second.eventId);
    assert.equal(first.eventId.length, 64);
  });

  it("limita o backoff entre cinco segundos e doze horas", () => {
    assert.equal(webhookRetryDelayMs(1), 5_000);
    assert.equal(webhookRetryDelayMs(2), 30_000);
    assert.equal(webhookRetryDelayMs(10), 12 * 60 * 60_000);
    assert.equal(webhookRetryDelayMs(99), 12 * 60 * 60_000);
  });

  it("descarta antes da gravação grupos e eventos de presença", () => {
    assert.deepEqual(
      shouldPersistWebhookEvent("received", {
        chat: { id: "120363000000@g.us" },
        sender: { id: "5511999999999@s.whatsapp.net" },
        msgContent: { conversation: "mensagem do grupo" },
      }),
      { persist: false, reason: "grupo-nao-suportado" },
    );
    assert.deepEqual(shouldPersistWebhookEvent("presence", { chat: { id: "5511999999999@s.whatsapp.net" } }), {
      persist: false,
      reason: "evento-nao-relevante",
    });
    assert.deepEqual(
      shouldPersistWebhookEvent("webhookReceived", {
        sender: { id: "5511999999999@s.whatsapp.net" },
        chat: { id: "5511999999999@s.whatsapp.net" },
        msgContent: { conversation: "mensagem 1:1" },
      }),
      { persist: true },
    );
    assert.deepEqual(shouldPersistWebhookEvent("connected", { data: { connected: true } }), { persist: true });
  });

  it("mantém apenas os campos necessários para processar uma mensagem e baixar mídia", () => {
    const compacted = compactWebhookPayload({
      messageId: "message-43",
      fromMe: false,
      sender: { id: "5511999999999@s.whatsapp.net", pushName: "Cliente", discarded: "não salvar" },
      chat: { id: "5511999999999@s.whatsapp.net", discarded: "não salvar" },
      msgContent: {
        imageMessage: {
          caption: "Comprovante",
          URL: "https://mmg.whatsapp.net/file.enc",
          mediaKey: "secret-for-media-decryption",
          mimetype: "image/jpeg",
          jpegThumbnail: "base64-grande-que-nao-precisa-ser-salvo",
          discarded: { nested: true },
        },
      },
      wholeProviderEnvelope: { expensive: true },
    });

    assert.deepEqual(compacted, {
      messageId: "message-43",
      fromMe: false,
      sender: { id: "5511999999999@s.whatsapp.net", pushName: "Cliente" },
      chat: { id: "5511999999999@s.whatsapp.net" },
      msgContent: {
        imageMessage: {
          caption: "Comprovante",
          URL: "https://mmg.whatsapp.net/file.enc",
          mimetype: "image/jpeg",
          mediaKey: "secret-for-media-decryption",
        },
      },
    });
  });
});
