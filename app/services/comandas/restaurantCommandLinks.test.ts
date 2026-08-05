import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detachRestaurantCommandLinks } from "./restaurantCommandLinks";

describe("detachRestaurantCommandLinks", () => {
  it("desvincula pedidos e encerra a sessao ativa quando era a ultima comanda", async () => {
    const calls: string[] = [];
    const tx = {
      restauranteSessaoMesaComanda: {
        findMany: async () => [{ sessaoId: 7, Sessao: { mesaId: 3, status: "ABERTA" } }],
        deleteMany: async () => { calls.push("delete-links"); return { count: 1 }; },
        count: async () => 0,
      },
      restaurantePedido: {
        updateMany: async () => { calls.push("unlink-orders"); return { count: 2 }; },
      },
      restauranteSessaoMesa: {
        updateMany: async () => { calls.push("cancel-session"); return { count: 1 }; },
      },
      restauranteMesa: {
        updateMany: async () => { calls.push("clean-table"); return { count: 1 }; },
      },
    };

    const result = await detachRestaurantCommandLinks(tx, 11, 22);

    assert.deepEqual(calls, ["unlink-orders", "delete-links", "cancel-session", "clean-table"]);
    assert.deepEqual(result, { linkedSessionIds: [7], cancelledSessionIds: [7] });
  });

  it("mantem a sessao ativa quando ainda existe outra comanda", async () => {
    let sessionUpdates = 0;
    const tx = {
      restauranteSessaoMesaComanda: {
        findMany: async () => [{ sessaoId: 7, Sessao: { mesaId: 3, status: "ABERTA" } }],
        deleteMany: async () => ({ count: 1 }),
        count: async () => 1,
      },
      restaurantePedido: { updateMany: async () => ({ count: 0 }) },
      restauranteSessaoMesa: { updateMany: async () => { sessionUpdates += 1; return { count: 1 }; } },
      restauranteMesa: { updateMany: async () => ({ count: 1 }) },
    };

    const result = await detachRestaurantCommandLinks(tx, 11, 22);

    assert.equal(sessionUpdates, 0);
    assert.deepEqual(result.cancelledSessionIds, []);
  });
});
