import assert from "node:assert/strict";
import test from "node:test";
import { restaurantPaymentAction } from "./payment";

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
