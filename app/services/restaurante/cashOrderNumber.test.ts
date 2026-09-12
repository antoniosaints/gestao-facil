import assert from "node:assert/strict";
import test from "node:test";

import { withRestaurantCashOrderNumber } from "./cashOrderNumber";

test("numera pedidos por caixa sem alterar o identificador persistido", async () => {
  const db = {
    restaurantePedido: {
      findMany: async () => [
        { id: 10, restauranteCaixaId: 7 },
        { id: 12, restauranteCaixaId: 7 },
        { id: 13, restauranteCaixaId: 8 },
        { id: 14, restauranteCaixaId: 7 },
      ],
    },
  };

  const pedidos = await withRestaurantCashOrderNumber(db, [
    { id: 14, restauranteCaixaId: 7, codigo: "INTERNO-A" },
    { id: 13, restauranteCaixaId: 8, codigo: "INTERNO-B" },
  ]);

  assert.deepEqual(pedidos.map((pedido) => [pedido.codigo, pedido.numeroPedido]), [["3", 3], ["1", 1]]);
});
