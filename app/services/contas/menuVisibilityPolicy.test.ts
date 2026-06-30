import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageMenuVisibility,
  normalizeVisibleMenuKeys,
  ROOT_ALWAYS_VISIBLE_MENU_KEYS,
} from "./menuVisibilityPolicy";

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
});
