import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAtendimentoAccess } from "./atendimentoAccessPolicy";

describe("atendimentoAccess", () => {
  it("bloqueia a conta sem o app Atendimento ativo", () => {
    assert.deepEqual(resolveAtendimentoAccess(false, null), { enabled: false, reason: "app-inativo" });
  });

  it("mantém disponível para contas sem whitelist de menus", () => {
    assert.deepEqual(resolveAtendimentoAccess(true, null), { enabled: true, reason: null });
  });

  it("bloqueia uma whitelist que oculta o menu raiz Atendimento", () => {
    assert.deepEqual(resolveAtendimentoAccess(true, ["vendas", "atendimento:chat"]), {
      enabled: false,
      reason: "menu-oculto",
    });
  });

  it("libera quando o app e o menu Atendimento estão ativos", () => {
    assert.deepEqual(resolveAtendimentoAccess(true, ["vendas", "atendimento"]), { enabled: true, reason: null });
  });
});
