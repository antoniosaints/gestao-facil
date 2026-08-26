import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { customerReplyForRestaurantOrderError } from "./whatsappAgentService";
import { restaurantOrderTool } from "./whatsappAgentAI";

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

describe("restaurantOrderTool", () => {
  it("obriga a IA a criar o pedido antes de afirmar um Pix", () => {
    const declaration = restaurantOrderTool[0].functionDeclarations?.[0];
    assert.equal(declaration?.name, "criar_pedido_restaurante");
    assert.match(declaration?.description || "", /Mercado Pago/i);
    assert.deepEqual(declaration?.parameters?.required, ["origem", "pagamento", "cliente", "itens"]);
  });
});
