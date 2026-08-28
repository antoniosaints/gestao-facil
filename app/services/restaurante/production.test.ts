import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOrderProductionState,
  dispatchOrderToProduction,
  ProductionRoutingMissingError,
} from "./production";

test("mantem pedido pendente sem tickets ou com todos pendentes", () => {
  assert.equal(deriveOrderProductionState([]), "PENDENTE");
  assert.equal(deriveOrderProductionState(["PENDENTE", "PENDENTE"]), "PENDENTE");
});

test("cria um ticket em cada ponto ativo associado a categoria", async () => {
  const createdPoints: number[] = [];
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async ({ data }: any) => {
        createdPoints.push(data.pontoId);
        return { id: data.pontoId };
      },
      findFirst: async () => null,
    },
    restaurantePedido: {
      findFirst: async () => ({
        id: 11,
        itens: [{ id: 21, catalogoItemId: 71, produtoId: 31, quantidade: 1, observacao: null }],
      }),
    },
    produto: {
      findMany: async () => [{ id: 31, ProdutoBase: { categoriaId: 41 } }],
    },
    restauranteCatalogoItem: {
      findMany: async () => [{ id: 71, categoriaId: 41 }],
    },
    restauranteRoteamentoProducao: {
      findMany: async () => [
        { pontoId: 51, categoriaId: 41, obrigatorio: true },
        { pontoId: 52, categoriaId: 41, obrigatorio: true },
      ],
    },
  };

  assert.equal(await dispatchOrderToProduction(tx, 1, 11), true);
  assert.deepEqual(createdPoints, [51, 52]);
});

test("nao cria tickets nem imprime enquanto o pedido ainda esta recebido", async () => {
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async () => assert.fail("pedido recebido nao deve gerar ticket"),
    },
    restaurantePedido: {
      findFirst: async () => ({ status: "RECEBIDO", itens: [] }),
    },
    produto: { findMany: async () => assert.fail("nao deve calcular rotas antes da confirmacao") },
    restauranteCatalogoItem: { findMany: async () => assert.fail("nao deve consultar o cardapio") },
    restauranteRoteamentoProducao: { findMany: async () => assert.fail("nao deve consultar rotas") },
  };

  assert.equal(await dispatchOrderToProduction(tx, 1, 11), false);
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
          { id: 21, catalogoItemId: 71, produtoId: 31, quantidade: 1, observacao: null },
          { id: 22, catalogoItemId: 72, produtoId: 32, quantidade: 1, observacao: null },
        ],
      }),
    },
    produto: {
      findMany: async () => [
        { id: 31, ProdutoBase: { categoriaId: 41 } },
        { id: 32, ProdutoBase: { categoriaId: 42 } },
      ],
    },
    restauranteCatalogoItem: {
      findMany: async () => [
        { id: 71, categoriaId: 41 },
        { id: 72, categoriaId: 42 },
      ],
    },
    restauranteRoteamentoProducao: {
      findMany: async () => [{ pontoId: 51, categoriaId: 41, obrigatorio: true }],
    },
    restaurantePontoProducao: { count: async () => 1 },
  };

  await assert.rejects(
    () => dispatchOrderToProduction(tx, 1, 11, { requireDestination: true }),
    ProductionRoutingMissingError,
  );
});

test("mantém o pedido no controle direto quando não há ponto KDS ativo", async () => {
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async () => assert.fail("não deve criar ticket sem ponto KDS ativo"),
    },
    restaurantePedido: {
      findFirst: async () => ({
        id: 11,
        itens: [{ id: 21, catalogoItemId: 71, produtoId: 31, quantidade: 1, observacao: null }],
      }),
    },
    produto: { findMany: async () => [{ id: 31, ProdutoBase: { categoriaId: 41 } }] },
    restauranteCatalogoItem: { findMany: async () => [{ id: 71, categoriaId: 41 }] },
    restauranteRoteamentoProducao: { findMany: async () => [] },
    restaurantePontoProducao: { count: async () => 0 },
  };

  assert.equal(await dispatchOrderToProduction(tx, 1, 11, { requireDestination: true }), false);
});

test("prioriza a categoria vinculada ao item do cardapio", async () => {
  const createdPoints: number[] = [];
  const tx = {
    restauranteTicketProducao: {
      count: async () => 0,
      create: async ({ data }: any) => {
        createdPoints.push(data.pontoId);
        return { id: data.pontoId };
      },
      findFirst: async () => null,
    },
    restaurantePedido: {
      findFirst: async () => ({
        id: 11,
        itens: [{ id: 21, catalogoItemId: 71, produtoId: 31, quantidade: 1, observacao: null }],
      }),
    },
    produto: {
      findMany: async () => [{ id: 31, ProdutoBase: { categoriaId: 41 } }],
    },
    restauranteCatalogoItem: {
      findMany: async () => [{ id: 71, categoriaId: 42 }],
    },
    restauranteRoteamentoProducao: {
      findMany: async () => [{ pontoId: 52, categoriaId: 42, obrigatorio: true }],
    },
  };

  assert.equal(await dispatchOrderToProduction(tx, 1, 11), true);
  assert.deepEqual(createdPoints, [52]);
});
