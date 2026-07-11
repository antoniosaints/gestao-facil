import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hashPassword,
  hashPasswordIfNeeded,
  isPasswordHashed,
  verifyPassword,
} from "./passwordService";

describe("passwordService", () => {
  it("gera um hash bcrypt e o reconhece", async () => {
    const hash = await hashPassword("V@sco123");
    assert.ok(hash.startsWith("$2"));
    assert.equal(isPasswordHashed(hash), true);
    assert.equal(isPasswordHashed("V@sco123"), false);
  });

  it("verifica senha contra hash bcrypt", async () => {
    const hash = await hashPassword("V@sco123");
    assert.equal(await verifyPassword("V@sco123", hash), true);
    assert.equal(await verifyPassword("errada", hash), false);
  });

  it("mantém compatibilidade com senha legada em texto puro", async () => {
    assert.equal(await verifyPassword("V@sco123", "V@sco123"), true);
    assert.equal(await verifyPassword("errada", "V@sco123"), false);
  });

  it("rejeita entradas vazias ou nulas", async () => {
    const hash = await hashPassword("V@sco123");
    assert.equal(await verifyPassword("", hash), false);
    assert.equal(await verifyPassword("V@sco123", null), false);
    assert.equal(await verifyPassword("V@sco123", ""), false);
  });

  it("não re-hasheia um valor que já é hash (evita quebrar edição)", async () => {
    const hash = await hashPassword("V@sco123");
    const mantido = await hashPasswordIfNeeded(hash);
    assert.equal(mantido, hash);
    assert.equal(await verifyPassword("V@sco123", mantido), true);
  });

  it("hashPasswordIfNeeded gera hash para texto puro", async () => {
    const gerado = await hashPasswordIfNeeded("V@sco123");
    assert.equal(isPasswordHashed(gerado), true);
    assert.equal(await verifyPassword("V@sco123", gerado), true);
  });
});
