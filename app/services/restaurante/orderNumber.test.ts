import assert from "node:assert/strict";
import test from "node:test";

import { reservarNumeroPedido } from "./orderNumber";

test("reserva o número sequencial da própria conta", async () => {
  let proximoNumeroPedido = 21;
  let receivedArgs: unknown;
  const tx = {
    restauranteConfig: {
      update: async (args: unknown) => {
        receivedArgs = args;
        proximoNumeroPedido += 1;
        return { proximoNumeroPedido };
      },
    },
  };

  const numero = await reservarNumeroPedido(tx, 42);

  assert.equal(numero, "21");
  assert.deepEqual(receivedArgs, {
    where: { contaId: 42 },
    data: { proximoNumeroPedido: { increment: 1 } },
    select: { proximoNumeroPedido: true },
  });
});
