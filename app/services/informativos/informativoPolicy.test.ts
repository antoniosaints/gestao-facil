import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInformativoVisible } from "./informativoPolicy";

const now = new Date("2026-07-18T18:00:00.000Z");
const context = { now, contaId: 10, moduloCodes: ["whatsapp"] };

describe("informativoPolicy", () => {
  it("shows a global published notice inside its window", () => {
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "GLOBAL", inicioEm: new Date("2026-07-18T17:00:00Z") }, context), true);
  });

  it("targets module notices only to accounts with that active app", () => {
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "MODULO", moduloCodigo: "whatsapp" }, context), true);
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "MODULO", moduloCodigo: "mercado-pago" }, context), false);
  });

  it("targets selected accounts", () => {
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "CONTAS", contaIds: [10, 11] }, context), true);
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "CONTAS", contaIds: [11] }, context), false);
  });

  it("keeps resolved notices visible for 24 hours and respects scheduling", () => {
    assert.equal(isInformativoVisible({ status: "RESOLVIDO", escopo: "GLOBAL", resolvidoEm: new Date("2026-07-17T19:00:00Z") }, context), true);
    assert.equal(isInformativoVisible({ status: "RESOLVIDO", escopo: "GLOBAL", resolvidoEm: new Date("2026-07-17T17:00:00Z") }, context), false);
    assert.equal(isInformativoVisible({ status: "PUBLICADO", escopo: "GLOBAL", inicioEm: new Date("2026-07-18T19:00:00Z") }, context), false);
  });
});
