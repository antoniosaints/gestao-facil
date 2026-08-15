import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Decimal from "decimal.js";
import { percentualDelta, totalOrdem } from "./resumo_os";

describe("painel de serviços", () => {
  it("calcula o total líquido da ordem considerando quantidade e desconto", () => {
    const total = totalOrdem({
      desconto: new Decimal(15),
      ItensOrdensServico: [
        { valor: new Decimal(50), quantidade: 2 },
        { valor: new Decimal(30), quantidade: 1 },
      ],
    });

    assert.equal(total, 115);
  });

  it("não permite que o desconto produza total negativo", () => {
    const total = totalOrdem({
      desconto: new Decimal(200),
      ItensOrdensServico: [{ valor: new Decimal(50), quantidade: 1 }],
    });

    assert.equal(total, 0);
  });

  it("calcula comparação percentual inclusive quando não há base anterior", () => {
    assert.equal(percentualDelta(150, 100), 50);
    assert.equal(percentualDelta(0, 0), 0);
    assert.equal(percentualDelta(100, 0), 100);
  });
});
