import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wApiMessageIdFromResponse, wApiSendAccepted } from "./wApiClient";

describe("wApiMessageIdFromResponse", () => {
  it("extrai o messageId retornado diretamente pela W-API", () => {
    assert.equal(
      wApiMessageIdFromResponse({
        instanceId: "instance-1",
        messageId: "3EB008AC64A43AD9D53A341CA82FC726",
        insertedId: "queue-1",
      }),
      "3EB008AC64A43AD9D53A341CA82FC726",
    );
  });

  it("extrai o identificador quando a resposta usa envelope data", () => {
    assert.equal(
      wApiMessageIdFromResponse({ data: { messageId: "3EB0-NESTED" } }),
      "3EB0-NESTED",
    );
  });

  it("extrai o identificador do resultado preservado junto aos metadados locais", () => {
    assert.equal(
      wApiMessageIdFromResponse({
        msgContent: { locationMessage: { name: "Loja" } },
        wapiResult: { messageId: "3EB0-LOCATION" },
      }),
      "3EB0-LOCATION",
    );
  });
});

describe("wApiSendAccepted", () => {
  it("aceita uma confirmação normal da W-API", () => {
    assert.equal(wApiSendAccepted({ messageId: "3EB0-OK" }), true);
  });

  it("detecta uma rejeição retornada com HTTP bem-sucedido", () => {
    assert.equal(wApiSendAccepted({ error: true, message: "Instância indisponível" }), false);
    assert.equal(wApiSendAccepted({ data: { success: false } }), false);
    assert.equal(wApiSendAccepted({ status: "failed" }), false);
    assert.equal(wApiSendAccepted(undefined), false);
  });
});
