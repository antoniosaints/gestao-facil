import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cobrancaCobreValorTotal } from "./cobrancaQuitacaoPolicy";

describe("cobrancaCobreValorTotal", () => {
  it("não considera quitada uma cobrança menor que o total", () => {
    assert.equal(cobrancaCobreValorTotal("70", "200"), false);
  });

  it("aceita o valor exato e valores superiores", () => {
    assert.equal(cobrancaCobreValorTotal("200", "200"), true);
    assert.equal(cobrancaCobreValorTotal("200.01", "200"), true);
  });

  it("compara valores monetários sem imprecisão de ponto flutuante", () => {
    assert.equal(cobrancaCobreValorTotal("0.30", "0.3"), true);
    assert.equal(cobrancaCobreValorTotal("0.29", "0.3"), false);
  });
});
