import assert from "node:assert/strict";
import Decimal from "decimal.js";
import { describe, it } from "node:test";

import { computeRecompensa } from "./indicacaoService";

describe("indicacaoService.computeRecompensa", () => {
  it("calcula recompensa percentual sobre a base", () => {
    assert.equal(computeRecompensa("PERCENTUAL", 10, 70).toNumber(), 7);
    assert.equal(computeRecompensa("PERCENTUAL", 50, 120).toNumber(), 60);
  });

  it("usa valor fixo quando o tipo é VALOR", () => {
    assert.equal(computeRecompensa("VALOR", 15, 70).toNumber(), 15);
    assert.equal(computeRecompensa("VALOR", 15, 999).toNumber(), 15);
  });

  it("nunca retorna negativo e arredonda a 2 casas", () => {
    assert.equal(computeRecompensa("PERCENTUAL", -10, 70).toNumber(), 0);
    assert.equal(computeRecompensa("VALOR", -5, 70).toNumber(), 0);
    assert.equal(computeRecompensa("PERCENTUAL", 33.333, 100).toNumber(), 33.33);
  });

  it("aceita Decimal como entrada", () => {
    assert.equal(
      computeRecompensa("PERCENTUAL", new Decimal(20), new Decimal("49.90")).toNumber(),
      9.98,
    );
  });

  it("percentual zero resulta em zero", () => {
    assert.equal(computeRecompensa("PERCENTUAL", 0, 70).toNumber(), 0);
  });
});
