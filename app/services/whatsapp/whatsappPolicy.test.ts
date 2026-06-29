import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeletedWhatsAppInstanceId,
  buildWApiPaymentPayload,
  canDeleteWhatsAppPayment,
  canRemoveWhatsAppInstance,
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
