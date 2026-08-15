import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWebhookIdentity,
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
});
