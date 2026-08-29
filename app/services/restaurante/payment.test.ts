import assert from "node:assert/strict";
import test from "node:test";
import {
  MERCADO_PAGO_PIX_EXPIRATION_MS,
  RESTAURANT_PIX_EXPIRATION_MS,
  restaurantPaymentAction,
  restaurantPixDeadlines,
} from "./payment";

test("mantém 5 minutos para o cliente e 30 minutos no gateway do Pix", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const deadlines = restaurantPixDeadlines(now);

  assert.equal(RESTAURANT_PIX_EXPIRATION_MS, 5 * 60 * 1000);
  assert.equal(MERCADO_PAGO_PIX_EXPIRATION_MS, 30 * 60 * 1000);
  assert.equal(deadlines.customerExpiresAt.toISOString(), "2026-08-29T12:05:00.000Z");
  assert.equal(deadlines.gatewayExpiresAt.toISOString(), "2026-08-29T12:30:00.000Z");
});

test("preserva o QR Code retornado pelo Mercado Pago no Pix do restaurante", async () => {
  const qrCodeDataUrl = "data:image/png;base64,cXItZG8tbWVyY2Fkb3BhZ28=";
  const action = await restaurantPaymentAction({
    externalLink: "https://mercadopago.test/pix/123",
    pixCopiaCola: "0002012658pix-copia-e-cola",
    qrCodeDataUrl,
    dataVencimento: new Date("2026-08-26T15:00:00.000Z"),
  });

  assert.deepEqual(action, {
    type: "PIX",
    url: "https://mercadopago.test/pix/123",
    pixCopiaCola: "0002012658pix-copia-e-cola",
    qrCodeDataUrl,
    expiresAt: "2026-08-26T15:00:00.000Z",
  });
});
