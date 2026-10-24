import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../../../generated/client";
import { onboardingCadastroSchema, questionKeys } from "../../schemas/onboarding";
import { createAccountWithOnboarding } from "./createAccountWithOnboarding";
import { catalogVersion, onboardingConfig, OnboardingCatalogChanged } from "./onboardingService";
const catalog = [{ id: 7, codigo: "arena", nome: "Arena", preco: 0, status: true }, { id: 8, codigo: "whatsapp", nome: "WhatsApp", preco: 20, status: true }];
const onboarding = onboardingCadastroSchema.parse({ version: 1, respostas: Object.fromEntries(questionKeys.map(k => [k, k === "gerenciaQuadras"])), modulosSelecionados: ["arena", "whatsapp"], menusSelecionados: ["arena"], temaPersonalizado: onboardingConfig(catalog).themePresets[0].tema, catalogVersion: catalogVersion(catalog) });
const records = { created: { id: 42, vencimento: new Date(), valor: 70 }, user: { id: 3, nome: "Test", email: "test@example.org", senha: "private-hash", permissao: "root" } };
function transactionDouble(fail?: "parameters" | "module") {
  const events: string[] = [];
  const parameters: Prisma.ParametrosContaCreateArgs[] = [];
  const modules: Prisma.ModuloOnContaCreateArgs[] = [];
  // Deliberately narrow adapter: production always receives the actual Prisma transaction.
  const tx = {
    modulosAdicionais: { findMany: async () => { events.push("catalog"); return catalog; } },
    parametrosConta: { create: async (args: Prisma.ParametrosContaCreateArgs) => { events.push("parameters"); if (fail === "parameters") throw new Error("parameters failed"); parameters.push(args); } },
    moduloOnConta: { create: async (args: Prisma.ModuloOnContaCreateArgs) => { events.push("module"); if (fail === "module") throw new Error("module failed"); modules.push(args); } },
  } as unknown as Prisma.TransactionClient;
  return { tx, events, parameters, modules, create: async () => { events.push("account-user"); return records; } };
}
test("legacy registration does not query catalog or persist onboarding and returns safe user DTO", async () => {
  const d = transactionDouble();
  const result = await createAccountWithOnboarding(d.tx, undefined, d.create);
  assert.deepEqual(d.events, ["account-user", "parameters"]);
  assert.deepEqual(d.parameters[0].data, { contaId: 42, estiloUi: "SIDEV2" });
  assert.deepEqual(result.user, { id: 3, nome: "Test", email: "test@example.org" });
  assert.equal("onboarding" in result, false);
  assert.equal("senha" in result.user, false);
  assert.equal(result.created.valor, 70);
});
test("registration persists profile/theme/menu and free modules through the same transaction", async () => {
  const d = transactionDouble();
  const result = await createAccountWithOnboarding(d.tx, onboarding, d.create);
  assert.deepEqual(d.events, ["catalog", "account-user", "parameters", "module"]);
  assert.deepEqual(d.parameters[0].data.temaPersonalizado, onboarding.temaPersonalizado);
  assert.deepEqual(d.parameters[0].data.menusVisiveis, result.onboarding?.menusEfetivos);
  const profile = d.parameters[0].data.onboardingPerfil as Record<string, unknown>;
  assert.deepEqual(profile.respostas, onboarding.respostas);
  assert.ok(typeof profile.concluidoEm === "string");
  assert.equal(d.modules.length, 1);
  assert.equal(d.modules[0].data.moduloId, 7);
  assert.equal(d.modules[0].data.valorAdicional, 0);
  assert.equal(d.modules[0].data.vencimento, records.created.vencimento);
});
test("catalog conflict stops creation before account and user callback", async () => {
  const d = transactionDouble();
  await assert.rejects(() => createAccountWithOnboarding(d.tx, { ...onboarding, catalogVersion: "0".repeat(64) }, d.create), OnboardingCatalogChanged);
  assert.deepEqual(d.events, ["catalog"]);
  assert.equal(d.parameters.length, 0);
  assert.equal(d.modules.length, 0);
});
test("parameter or module write errors reject the transaction callback", async () => {
  for (const fail of ["parameters", "module"] as const) {
    const d = transactionDouble(fail);
    await assert.rejects(() => createAccountWithOnboarding(d.tx, onboarding, d.create), new RegExp(fail + " failed"));
  }
});
