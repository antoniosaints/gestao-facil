import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import {
  customerReplyForRestaurantOrderError,
  filterAgentsAttendingNow,
} from "./whatsappAgentService";
import { restaurantOrderTool } from "./whatsappAgentAI";

describe("customerReplyForRestaurantOrderError", () => {
  it("suprime os detalhes JSON de uma diretiva de pedido inválida", () => {
    let validationError: unknown;
    try {
      z.object({ origem: z.enum(["RETIRADA", "DELIVERY"]) }).parse({
        origem: "whatsapp",
      });
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
    const declaration =
      "functionDeclarations" in restaurantOrderTool[0]
        ? restaurantOrderTool[0].functionDeclarations?.[0]
        : undefined;
    assert.equal(declaration?.name, "criar_pedido_restaurante");
    assert.match(declaration?.description || "", /Mercado Pago/i);
    assert.deepEqual(declaration?.parameters?.required, [
      "origem",
      "pagamento",
      "cliente",
      "itens",
    ]);
  });
});

describe("disponibilidade de agentes", () => {
  it("avalia todos os agentes pela data atual, sem usar o índice do array como data", () => {
    const agents = [
      {
        id: 1,
        ativo: true,
        diasSemana: "2",
        horaInicio: "11:00",
        horaFim: "13:00",
      },
      {
        id: 2,
        ativo: true,
        diasSemana: "2",
        horaInicio: "11:00",
        horaFim: "13:00",
      },
      { id: 3, ativo: false, diasSemana: "2", horaInicio: null, horaFim: null },
    ];
    assert.deepEqual(
      filterAgentsAttendingNow(agents, new Date("2026-11-17T15:00:00Z")).map(
        (agent) => agent.id,
      ),
      [1, 2],
    );
    assert.deepEqual(
      filterAgentsAttendingNow(agents, new Date("2026-11-17T21:00:00Z")),
      [],
    );
  });
});
