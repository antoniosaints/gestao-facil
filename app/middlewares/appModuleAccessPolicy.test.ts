import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppModuleAccess } from "./appModuleAccessPolicy";

async function request(check: (id: number, code: string) => Promise<boolean>, code = "whatsapp", contaId?: number, allowed?: () => Promise<boolean>) {
  let status = 200, body: any, proceeded = false;
  const response = { status(value: number) { status = value; return this; }, json(value: any) { body = value; return this; } };
  const gate = createAppModuleAccess(code, code, check, allowed);
  await gate({ customData: contaId === undefined ? undefined : { contaId } } as any, response as any, () => { proceeded = true; });
  return { status, body, proceeded };
}
describe("acesso aos apps nas APIs privadas", () => {
  it("nega acesso sem sessão antes de consultar o app", async () => {
    const result = await request(async () => { throw new Error("Não deve consultar sem conta"); });
    assert.equal(result.status, 401); assert.equal(result.proceeded, false);
  });
  it("consulta o app usando a conta autenticada e libera somente o app ativo", async () => {
    const result = await request(async (id, code) => { assert.equal(id, 37); assert.equal(code, "arena"); return true; }, "arena", 37);
    assert.equal(result.status, 200); assert.equal(result.proceeded, true);
  });
  it("não sugere instalar apps para quem não tem permissão de acesso", async () => {
    const result = await request(async () => { throw new Error("Não deve consultar o app"); }, "whatsapp", 37, async () => false);
    assert.equal(result.status, 403); assert.equal(result.proceeded, false);
    assert.equal(result.body.error.code, "app_access_forbidden");
  });
  it("devolve orientação identificável quando WhatsApp, Arena ou Loja Virtual não estão ativos", async () => {
    for (const code of ["whatsapp", "arena", "loja-virtual"]) {
      const result = await request(async () => false, code, 37);
      assert.equal(result.status, 403); assert.equal(result.proceeded, false);
      assert.equal(result.body.error.code, `${code.replace(/-/g, "_")}_module_inactive`);
    }
  });
  it("não confunde indisponibilidade de consulta com app inativo", async () => {
    const result = await request(async () => { throw new Error("Banco indisponível"); }, "whatsapp", 37);
    assert.equal(result.status, 503); assert.equal(result.proceeded, false);
    assert.equal(result.body.error.code, "app_access_unavailable");
  });
});
