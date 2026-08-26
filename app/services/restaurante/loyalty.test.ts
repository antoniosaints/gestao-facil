import assert from "node:assert/strict";
import test from "node:test";
import { availableFidelityRewards, eligibleItemQuantity, publicFidelities, restoreReservedFidelityRewards } from "./loyalty";

test("soma as unidades elegíveis do mesmo pedido para a promoção", async () => {
  const quantity = await eligibleItemQuantity(
    { restauranteCatalogoItem: { findMany: async () => [{ id: 10, categoriaId: 7, Produto: null }, { id: 20, categoriaId: 9, Produto: null }] } },
    1,
    { itens: [{ catalogoItemId: 10, quantidade: 10 }, { catalogoItemId: 20, quantidade: 2 }] },
    { catalogoItemIdsJson: [], categoriaIdsJson: [7] },
  );

  assert.equal(quantity, 10);
});

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

test("devolve no cancelamento somente as recompensas reservadas pelo pedido", async () => {
  let received: any = null;
  const restored = await restoreReservedFidelityRewards({
    restauranteFidelidadeProgresso: {
      updateMany: async (args: any) => { received = args; return { count: 2 }; },
    },
  }, 4, "+55 (11) 99999-0000", [12, 12, "7", 0, "inválido"]);

  assert.equal(restored, true);
  assert.deepEqual(received.where, {
    contaId: 4,
    telefoneNormalizado: "5511999990000",
    programaId: { in: [12, 7] },
  });
  assert.deepEqual(received.data, { recompensasDisponiveis: { increment: 1 } });
});
