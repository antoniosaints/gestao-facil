import assert from "node:assert/strict";
import test from "node:test";
import { restaurantCatalogGroupsInclude } from "./catalogQuery";

test("catalogo privado inclui as opcoes ativas exigidas pelo Salao", () => {
  const options = restaurantCatalogGroupsInclude.include.Grupo.include.opcoes;
  assert.deepEqual(options.where, { ativo: true });
  assert.deepEqual(options.orderBy, [
    { ordem: "asc" },
    { id: "asc" },
  ]);
});
