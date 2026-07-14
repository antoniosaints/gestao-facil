import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateAvailableStock } from "./lojaInventoryService";
import { assertOrderTransition, nextCancellationStatus, reservationDurationMs } from "./lojaOrderPolicy";

describe("políticas da loja virtual", () => {
  it("desconta reservas do estoque disponível sem alterar o físico", () => {
    assert.equal(calculateAvailableStock(8, 3), 5);
    assert.equal(calculateAvailableStock(2, 4), 0);
  });

  it("usa 30 minutos para gateway e 24 horas para WhatsApp", () => {
    assert.equal(reservationDurationMs("GATEWAY"), 1_800_000);
    assert.equal(reservationDurationMs("WHATSAPP"), 86_400_000);
  });

  it("impede transições inválidas e exige estorno para pedido pago", () => {
    assert.doesNotThrow(() => assertOrderTransition("RECEBIDO", "CONFIRMADO"));
    assert.throws(() => assertOrderTransition("RECEBIDO", "DESPACHADO"));
    assert.equal(nextCancellationStatus("PAGO"), "CANCELAMENTO_PENDENTE");
    assert.equal(nextCancellationStatus("PENDENTE"), "CANCELADO");
  });
});
