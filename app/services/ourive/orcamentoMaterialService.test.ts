import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snapshotMaterialPrices } from "./orcamentoMaterialService";

describe("snapshotMaterialPrices", () => {
  it("preserva o valor alterado na linha em vez do preço nativo do produto", () => {
    assert.deepEqual(
      snapshotMaterialPrices({ custoUnitario: 82.5, valorUnitario: 149.9 }),
      { custoUnitario: 82.5, valorUnitario: 149.9 },
    );
  });

  it("preserva zero como valor intencional sem aplicar fallback", () => {
    assert.deepEqual(
      snapshotMaterialPrices({ custoUnitario: 0, valorUnitario: 0 }),
      { custoUnitario: 0, valorUnitario: 0 },
    );
  });
});
