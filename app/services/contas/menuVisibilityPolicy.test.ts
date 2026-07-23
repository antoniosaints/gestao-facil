import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageMenuVisibility,
  KNOWN_SUBMENU_KEYS,
  normalizeVisibleMenuKeys,
  ROOT_ALWAYS_VISIBLE_MENU_KEYS,
} from "./menuVisibilityPolicy";

// Espelho de MENU_SUBMENU_VISIBILITY_OPTIONS do frontend (frontend/src/layouts/options.ts).
// Se um submenu novo for adicionado lá, adicione aqui E em KNOWN_SUBMENU_KEYS — o teste
// "keeps every frontend submenu key" abaixo falha apontando a key descartada, evitando a
// regressão em que ocultar um submenu não persiste (backend descartava a key desconhecida).
const FRONTEND_SUBMENU_KEYS = [
  "vendas:painel",
  "vendas:lista",
  "vendas:pdv",
  "vendas:caixas",
  "financeiro:painel",
  "financeiro:lancamentos",
  "financeiro:acompanhamento",
  "financeiro:contas-a-receber",
  "financeiro:contas-a-pagar",
  "financeiro:assinaturas-a-pagar",
  "financeiro:inadimplencia",
  "financeiro:cobrancas",
  "financeiro:demonstrativo",
  "financeiro:plano-de-contas",
  "produtos:painel",
  "produtos:lista",
  "produtos:reposicao",
  "produtos:movimentacoes",
  "servicos:painel",
  "servicos:os",
  "servicos:lista",
  "arena:painel",
  "arena:calendario",
  "arena:reservas",
  "arena:quadras",
  "arena:comandas",
  "assinaturas:painel",
  "assinaturas:lista",
  "assinaturas:planos",
  "assinaturas:cobrancas",
  "assinaturas:comodatos",
  "atendimento:painel",
  "atendimento:chat",
  "atendimento:contatos",
  "atendimento:agentes",
  "atendimento:relatorios",
] as const;

describe("menuVisibilityPolicy", () => {
  it("allows only root users to manage sidebar menu visibility", () => {
    assert.equal(canManageMenuVisibility("root"), true);
    assert.equal(canManageMenuVisibility("admin"), false);
    assert.equal(canManageMenuVisibility("gerente"), false);
    assert.equal(canManageMenuVisibility(undefined), false);
  });

  it("normalizes menu keys by removing unknown and duplicated values", () => {
    assert.deepEqual(
      normalizeVisibleMenuKeys(["dashboard", "financeiro", "dashboard", "inexistente"]),
      ["dashboard", "financeiro", "configuracoes"]
    );
  });

  it("keeps the goals menu key when it is selected", () => {
    assert.deepEqual(
      normalizeVisibleMenuKeys(["dashboard", "metas", "configuracoes"]),
      ["dashboard", "metas", "configuracoes"]
    );
  });

  it("keeps root recovery menus selected even when omitted from the payload", () => {
    const normalized = normalizeVisibleMenuKeys(["dashboard"]);

    for (const key of ROOT_ALWAYS_VISIBLE_MENU_KEYS) {
      assert.equal(normalized.includes(key), true);
    }
  });

  it("keeps known submenu keys and drops unknown ones", () => {
    assert.deepEqual(
      normalizeVisibleMenuKeys([
        "vendas",
        "vendas:caixas",
        "financeiro:cobrancas",
        "vendas:inexistente",
      ]),
      ["vendas", "vendas:caixas", "financeiro:cobrancas", "configuracoes"]
    );
  });

  it("keeps every frontend submenu key (whitelist não pode divergir do frontend)", () => {
    const normalized = normalizeVisibleMenuKeys([...FRONTEND_SUBMENU_KEYS]);

    const dropped = FRONTEND_SUBMENU_KEYS.filter(
      (key) => !normalized?.includes(key)
    );

    assert.deepEqual(
      dropped,
      [],
      `Keys de submenu do frontend descartadas pelo backend: ${dropped.join(", ")}. ` +
        "Adicione-as em KNOWN_SUBMENU_KEYS (menuVisibilityPolicy.ts)."
    );
  });

  it("does not carry submenu keys unknown to the frontend", () => {
    const frontend = new Set<string>(FRONTEND_SUBMENU_KEYS);
    const extra = KNOWN_SUBMENU_KEYS.filter((key) => !frontend.has(key));

    assert.deepEqual(
      extra,
      [],
      `KNOWN_SUBMENU_KEYS possui keys ausentes no frontend: ${extra.join(", ")}.`
    );
  });
});
