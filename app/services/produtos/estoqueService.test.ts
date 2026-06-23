import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canDiscardProdutoStock,
  getProdutoDescarteUpdate,
} from "./estoqueService";

describe("estoqueService", () => {
  it("allows discard when quantity is within current stock", () => {
    assert.equal(canDiscardProdutoStock(10, 4), true);
    assert.equal(canDiscardProdutoStock(10, 10), true);
  });

  it("blocks discard when quantity is greater than current stock", () => {
    assert.equal(canDiscardProdutoStock(3, 4), false);
  });

  it("builds a direct stock decrement without inventory movement data", () => {
    assert.deepEqual(getProdutoDescarteUpdate(5), {
      estoque: {
        decrement: 5,
      },
    });
  });
});
