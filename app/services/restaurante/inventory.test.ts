import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRestaurantStockRequirements, RestauranteEstoqueError } from "./inventory";

describe("buildRestaurantStockRequirements", () => {
  it("inclui produto principal e produtos vinculados a sabores e complementos", () => {
    const result = buildRestaurantStockRequirements(
      [{
        id: 10,
        produtoId: 1,
        quantidade: 2,
        selecoesSnapshotJson: [{ produtoId: 2 }, { produtoId: 3 }, { produtoId: null }],
      }],
      [
        { id: 1, nome: "Pizza", controlaEstoque: true, saidas: true },
        { id: 2, nome: "Calabresa", controlaEstoque: true, saidas: true },
        { id: 3, nome: "Borda", controlaEstoque: true, saidas: true },
      ],
    );

    assert.deepEqual(result, [
      { pedidoItemId: 10, produtoId: 1, quantidade: 2, main: true },
      { pedidoItemId: 10, produtoId: 2, quantidade: 2, main: false },
      { pedidoItemId: 10, produtoId: 3, quantidade: 2, main: false },
    ]);
  });

  it("agrega o mesmo produto quando ele aparece mais de uma vez no item", () => {
    const result = buildRestaurantStockRequirements(
      [{ id: 11, produtoId: 1, quantidade: 3, selecoesSnapshotJson: [{ produtoId: 2 }, { produtoId: 2 }] }],
      [
        { id: 1, nome: "Produto", controlaEstoque: false, saidas: true },
        { id: 2, nome: "Adicional", controlaEstoque: true, saidas: true },
      ],
    );
    assert.deepEqual(result, [{ pedidoItemId: 11, produtoId: 2, quantidade: 6, main: false }]);
  });

  it("recusa quantidade fracionada para produto controlado por unidade", () => {
    assert.throws(
      () => buildRestaurantStockRequirements(
        [{ id: 12, produtoId: 1, quantidade: 0.5, selecoesSnapshotJson: null }],
        [{ id: 1, nome: "Refrigerante", controlaEstoque: true, saidas: true }],
      ),
      (error) => error instanceof RestauranteEstoqueError && error.code === "invalid_stock_quantity",
    );
  });
});
