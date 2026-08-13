import assert from "node:assert/strict";
import test from "node:test";
import { fiscalStatusFromProvider } from "./fiscalProviderPolicy";

test("normaliza os estados finais e pendentes do PlugNotas", () => {
  assert.equal(fiscalStatusFromProvider("CONCLUÍDO"), "AUTORIZADA");
  assert.equal(fiscalStatusFromProvider("REJEITADO"), "REJEITADA");
  assert.equal(fiscalStatusFromProvider("CANCELADO"), "CANCELADA");
  assert.equal(fiscalStatusFromProvider("PROCESSANDO"), "EM_PROCESSAMENTO");
});
