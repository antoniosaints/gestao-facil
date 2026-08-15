import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capabilitiesForRestaurantRoles, resolveRestaurantAccess, RESTAURANTE_CAPABILITIES } from "./access";

describe("capabilitiesForRestaurantRoles", () => {
  it("concede todas as capacidades ao gestor", () => {
    assert.deepEqual(capabilitiesForRestaurantRoles(["GESTOR"]).sort(), [...RESTAURANTE_CAPABILITIES].sort());
  });

  it("separa operacao de salao e cozinha", () => {
    const garcom = capabilitiesForRestaurantRoles(["GARCOM"]);
    const cozinha = capabilitiesForRestaurantRoles(["COZINHA"]);

    assert.ok(garcom.includes("SALAO_OPERAR"));
    assert.ok(!garcom.includes("KDS_OPERAR"));
    assert.ok(cozinha.includes("KDS_OPERAR"));
    assert.ok(!cozinha.includes("SALAO_OPERAR"));
  });

  it("combina multiplos papeis sem duplicar capacidades", () => {
    const capabilities = capabilitiesForRestaurantRoles(["CAIXA", "EXPEDICAO"]);
    assert.equal(capabilities.length, new Set(capabilities).size);
    assert.ok(capabilities.includes("COMANDAS_OPERAR"));
    assert.ok(capabilities.includes("PEDIDOS_OPERAR"));
  });
});

describe("resolveRestaurantAccess", () => {
  it("nao herda permissoes gerais quando o usuario nao possui papel no restaurante", () => {
    assert.deepEqual(resolveRestaurantAccess({
      user: { id: 10, permissao: "gerente", superAdmin: false },
      configuredRoles: [],
    }), { papeis: [], capabilities: [], fallbackLegado: false });
  });

  it("mantem administradores como gestores", () => {
    const access = resolveRestaurantAccess({
      user: { id: 10, permissao: "admin", superAdmin: false },
      configuredRoles: [],
    });
    assert.deepEqual(access.papeis, ["GESTOR"]);
    assert.deepEqual(access.capabilities.sort(), [...RESTAURANTE_CAPABILITIES].sort());
  });
});
