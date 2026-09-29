import assert from "node:assert/strict";
import { test } from "node:test";
import { fiscalRecipientStatus } from "./fiscalRecipientPolicy";

test("distingue venda sem cliente de cliente sem documento", () => {
  assert.equal(fiscalRecipientStatus(null), "SEM_CLIENTE");
  assert.equal(fiscalRecipientStatus({ documento: "" }), "SEM_DOCUMENTO");
});

test("aceita CPF e CNPJ válidos com ou sem máscara", () => {
  assert.equal(fiscalRecipientStatus({ documento: "529.982.247-25" }), "DOCUMENTO_VALIDO");
  assert.equal(fiscalRecipientStatus({ documento: "52998224725" }), "DOCUMENTO_VALIDO");
  assert.equal(fiscalRecipientStatus({ documento: "04.252.011/0001-10" }), "DOCUMENTO_VALIDO");
  assert.equal(fiscalRecipientStatus({ documento: "04252011000110" }), "DOCUMENTO_VALIDO");
  assert.equal(fiscalRecipientStatus({ documento: "529.982.247-26" }), "DOCUMENTO_INVALIDO");
});
