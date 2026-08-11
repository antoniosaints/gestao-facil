import assert from "node:assert/strict";
import test from "node:test";
import { canCustomerCancelRestaurantOrder, resolveRestaurantCancellation } from "./orderPolicy";

test("pedido pago é cancelado e segue para revisão financeira", () => {
  assert.deepEqual(resolveRestaurantCancellation("PAGO"), {
    cancelOrder: true,
    nextPaymentStatus: "EM_REVISAO",
    returnStock: true,
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

test("cliente pode cancelar enquanto o ticket ainda está pendente", () => {
  assert.equal(canCustomerCancelRestaurantOrder({
    status: "CONFIRMADO",
    tickets: [{ status: "PENDENTE", iniciadoAt: null }],
  }), true);
});

test("cliente não pode cancelar após a cozinha iniciar o preparo", () => {
  assert.equal(canCustomerCancelRestaurantOrder({
    status: "EM_PREPARO",
    emPreparoAt: new Date(),
    tickets: [{ status: "PREPARANDO", iniciadoAt: new Date() }],
  }), false);
});
