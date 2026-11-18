import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeletedWhatsAppInstanceId,
  buildWApiPaymentPayload,
  canDeleteWhatsAppPayment,
  canRemoveWhatsAppInstance,
  mapWApiInstanceStatusFromPayload,
  mapWApiFetchInstancePayload,
  mapWApiMessageStatus,
  mapWApiPaymentStatus,
} from "./whatsappPolicy";

describe("whatsappPolicy", () => {
  it("allows removing instances without requiring previous disconnect", () => {
    assert.equal(canRemoveWhatsAppInstance({ status: "DESCONECTADA" }), true);
    assert.equal(canRemoveWhatsAppInstance({ status: "CONECTADA" }), true);
    assert.equal(canRemoveWhatsAppInstance({ status: "CONECTANDO" }), true);
  });

  it("allows deleting only pending WhatsApp payments", () => {
    assert.equal(canDeleteWhatsAppPayment({ status: "PENDENTE" }), true);
    assert.equal(canDeleteWhatsAppPayment({ status: "PAGO" }), false);
    assert.equal(canDeleteWhatsAppPayment({ status: "FALHOU" }), false);
    assert.equal(canDeleteWhatsAppPayment({ status: "CANCELADO" }), false);
  });

  it("builds W-API payment payload with account email and optional webhook", () => {
    assert.deepEqual(
      buildWApiPaymentPayload("conta@example.com", "https://erp.test/webhook"),
      {
        payerEmail: "conta@example.com",
        webhookPaymentUrl: "https://erp.test/webhook",
      }
    );

    assert.deepEqual(buildWApiPaymentPayload("conta@example.com"), {
      payerEmail: "conta@example.com",
    });
  });

  it("maps W-API payment statuses into local monthly control statuses", () => {
    assert.equal(mapWApiPaymentStatus({ status: "approved" }), "PAGO");
    assert.equal(mapWApiPaymentStatus({ status: "paid" }), "PAGO");
    assert.equal(mapWApiPaymentStatus({ status: "failed" }), "FALHOU");
    assert.equal(mapWApiPaymentStatus({ status: "canceled" }), "CANCELADO");
    assert.equal(mapWApiPaymentStatus({ status: "waiting" }), "PENDENTE");
  });

  it("maps W-API boolean connection status into local instance status", () => {
    assert.equal(mapWApiInstanceStatusFromPayload({ connected: true }), "CONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ connected: false }), "DESCONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ result: { connected: true } }), "CONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ data: { connected: false } }), "DESCONECTADA");
  });

  it("não confunde disconnected e desconectado com connected", () => {
    assert.equal(mapWApiInstanceStatusFromPayload({ status: "disconnected" }), "DESCONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ data: { status: "desconectado" } }), "DESCONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ status: "connected" }), "CONECTADA");
    assert.equal(mapWApiInstanceStatusFromPayload({ status: "connecting" }), "CONECTANDO");
  });

  it("interpreta o exemplo atual de fetch-instance sem confundir pagamento e conexão", () => {
    assert.deepEqual(mapWApiFetchInstancePayload({
      instanceId: "instance-test", connected: false, connectedPhone: "5511999999999",
      paymentStatus: "PAID", expires: 1737137931513,
    }), {
      status: "DESCONECTADA", connectedPhone: "5511999999999",
      assinaturaStatus: "PAID", expiresAt: new Date(1737137931513),
    });
  });

  it("interpreta os callbacks atuais de envio, recebimento e leitura", () => {
    assert.equal(mapWApiMessageStatus({ event: "webhookDelivery", messageId: "wa-message", fromMe: true }), "ENVIADA");
    assert.equal(mapWApiMessageStatus({ event: "webhookStatus", messageId: "wa-message", status: "RECEIVED" }), "ENTREGUE");
    assert.equal(mapWApiMessageStatus({ event: "webhookStatus", messageId: "wa-message", status: "READ" }), "LIDA");
    assert.equal(mapWApiMessageStatus({ event: "webhookDelivery", status: "FAILED" }), "ERRO");
    assert.equal(mapWApiMessageStatus({ data: { status: "RECEIVED" } }), "ENTREGUE");
    assert.equal(mapWApiMessageStatus({ ack: 3 }), "ENTREGUE");
    assert.equal(mapWApiMessageStatus({}), "PENDENTE");
  });

  it("builds a deleted instance id that frees the original external id", () => {
    assert.equal(
      buildDeletedWhatsAppInstanceId(
        "instancia/abc",
        42,
        new Date("2026-06-23T10:11:12.000Z")
      ),
      "instancia-abc__deleted_42_20260623101112"
    );
  });
});
