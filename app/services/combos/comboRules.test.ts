import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { comboSchema } from "../../schemas/combos";
import { allocateComboComponentValues } from "./comboService";

describe("combo rules", () => {
  it("requires at least one component", () => {
    const result = comboSchema.safeParse({
      nome: "Combo",
      preco: 10,
      ativo: true,
      mostrarNoPdv: true,
      mostrarOnline: true,
      componentes: [],
    });
    assert.equal(result.success, false);
  });

  it("rejects duplicated components and non-positive quantities", () => {
    const duplicated = comboSchema.safeParse({
      nome: "Combo",
      preco: 10,
      componentes: [
        { tipo: "PRODUTO", id: 1, quantidade: 1 },
        { tipo: "PRODUTO", id: 1, quantidade: 2 },
      ],
    });
    const invalidQuantity = comboSchema.safeParse({
      nome: "Combo",
      preco: 10,
      componentes: [{ tipo: "SERVICO", id: 2, quantidade: 0 }],
    });
    assert.equal(duplicated.success, false);
    assert.equal(invalidQuantity.success, false);
  });

  it("allocates cents proportionally and applies the residue to the last component", () => {
    const allocated = allocateComboComponentValues(10, [1, 1, 1]);
    assert.deepEqual(allocated.map((value) => value.toFixed(2)), ["3.33", "3.33", "3.34"]);
    assert.equal(allocated.reduce((sum, value) => sum.plus(value)).toFixed(2), "10.00");
  });
});
