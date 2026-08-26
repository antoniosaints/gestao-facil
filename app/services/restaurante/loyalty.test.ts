import assert from "node:assert/strict";
import test from "node:test";
import { availableFidelityRewards, publicFidelities } from "./loyalty";

test("mantém recompensas independentes para cada promoção no mesmo carrinho", () => {
  const programs = [
    { program: { id: 1, ativo: true, premioCatalogoItemId: 10, descontoPercentual: 100 }, progress: { recompensasDisponiveis: 1 } },
    { program: { id: 2, ativo: true, premioCatalogoItemId: 20, descontoPercentual: 50 }, progress: { recompensasDisponiveis: 1 } },
    { program: { id: 3, ativo: true, premioCatalogoItemId: 10, descontoPercentual: 25 }, progress: { recompensasDisponiveis: 1 } },
  ];
  const rewards = availableFidelityRewards({ programs }, [{ item: { id: 10 }, unit: 12 }, { item: { id: 20 }, unit: 8 }]);

  assert.deepEqual(rewards.map((reward) => reward.program.id), [1, 2]);
});

test("publica apenas as promoções ativas com prêmio definido", () => {
  const result = publicFidelities([
    { program: { ativo: false, premioCatalogoItemId: 1 } },
    { program: { ativo: true, premioCatalogoItemId: null } },
    { program: { ativo: true, pedidosMeta: 5, categoriaIdsJson: [], catalogoItemIdsJson: [], descontoPercentual: 100, premioCatalogoItemId: 1, PremioCatalogoItem: { id: 1, nomePublico: "Suco" } }, progress: null },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.premio?.nome, "Suco");
});
