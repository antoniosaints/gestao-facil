import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOrderProductionState,
  dispatchOrderToProduction,
  ProductionRoutingConflictError,
  ProductionRoutingMissingError,
} from "./production";

test("mantem pedido pendente sem tickets ou com todos pendentes", () => {
  assert.equal(deriveOrderProductionState([]), "PENDENTE");
  assert.equal(deriveOrderProductionState(["PENDENTE", "PENDENTE"]), "PENDENTE");
});

test("rejeita categoria associada a dois pontos ativos para nao duplicar o KDS", async () => {
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async () => assert.fail("nao deve criar tickets com roteamento ambiguo"),
    },
    restaurantePedido: {
      findFirst: async () => ({
        id: 11,
        itens: [{ id: 21, produtoId: 31, quantidade: 1, observacao: null }],
      }),
    },
    produto: {
      findMany: async () => [{ id: 31, ProdutoBase: { categoriaId: 41 } }],
    },
    restauranteRoteamentoProducao: {
      findMany: async () => [
        { pontoId: 51, categoriaId: 41, obrigatorio: true },
        { pontoId: 52, categoriaId: 41, obrigatorio: true },
      ],
    },
  };

  await assert.rejects(
    () => dispatchOrderToProduction(tx, 1, 11),
    ProductionRoutingConflictError,
  );
});

test("considera preparo quando qualquer ponto iniciou", () => {
  assert.equal(deriveOrderProductionState(["PREPARANDO", "PENDENTE"]), "PREPARANDO");
  assert.equal(deriveOrderProductionState(["PRONTO", "PENDENTE"]), "PREPARANDO");
});

test("so libera o pedido quando todos os pontos terminaram", () => {
  assert.equal(deriveOrderProductionState(["PRONTO", "ENTREGUE"]), "PRONTO");
  assert.equal(deriveOrderProductionState(["ENTREGUE", "ENTREGUE"]), "ENTREGUE");
});

test("rejeita pedido interno quando qualquer item nao possui destino de producao", async () => {
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async () => assert.fail("nao deve criar ticket sem roteamento"),
    },
    restaurantePedido: {
      findFirst: async () => ({
        id: 11,
        itens: [
          { id: 21, produtoId: 31, quantidade: 1, observacao: null },
          { id: 22, produtoId: 32, quantidade: 1, observacao: null },
        ],
      }),
    },
    produto: {
      findMany: async () => [
        { id: 31, ProdutoBase: { categoriaId: 41 } },
        { id: 32, ProdutoBase: { categoriaId: 42 } },
      ],
    },
    restauranteRoteamentoProducao: {
      findMany: async () => [{ pontoId: 51, categoriaId: 41, obrigatorio: true }],
    },
  };

  await assert.rejects(
    () => dispatchOrderToProduction(tx, 1, 11, { requireDestination: true }),
    ProductionRoutingMissingError,
  );
});
