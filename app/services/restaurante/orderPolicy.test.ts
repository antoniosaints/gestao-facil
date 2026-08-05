import assert from "node:assert/strict";
import test from "node:test";
import { resolveRestaurantCancellation } from "./orderPolicy";

test("pedido pago entra em revisao sem cancelar nem devolver estoque", () => {
  assert.deepEqual(resolveRestaurantCancellation("PAGO"), {
    cancelOrder: false,
    nextPaymentStatus: "EM_REVISAO",
    returnStock: false,
    httpStatus: 202,
  });
});

test("pedido sem pagamento confirmado pode ser cancelado imediatamente", () => {
  assert.deepEqual(resolveRestaurantCancellation("NA_ENTREGA"), {
    cancelOrder: true,
    nextPaymentStatus: "NA_ENTREGA",
    returnStock: true,
    httpStatus: 200,
  });
});
