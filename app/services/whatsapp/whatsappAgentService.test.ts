import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { customerReplyForRestaurantOrderError } from "./whatsappAgentService";

describe("customerReplyForRestaurantOrderError", () => {
  it("suprime os detalhes JSON de uma diretiva de pedido inválida", () => {
    let validationError: unknown;
    try {
      z.object({ origem: z.enum(["RETIRADA", "DELIVERY"]) }).parse({ origem: "whatsapp" });
    } catch (error) {
      validationError = error;
    }

    assert.equal(customerReplyForRestaurantOrderError(validationError), null);
  });

  it("mantém apenas uma mensagem segura para falhas não relacionadas à validação", () => {
    assert.equal(
      customerReplyForRestaurantOrderError(new Error('{"token":"interno"}')),
      "Não foi possível confirmar o pedido agora. Revise os dados e tente novamente.",
    );
  });
});
