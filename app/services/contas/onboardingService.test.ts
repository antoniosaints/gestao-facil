import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingCadastroSchema, onboardingPreviewSchema, questionKeys } from "../../schemas/onboarding";
import { activateFreeOnboardingModules, baseMenuKeys, catalogVersion, onboardingConfig, OnboardingCatalogChanged, previewOnboarding } from "./onboardingService";
import type { CatalogModule } from "./onboardingService";
import type { Prisma } from "../../../generated/client";
const respostas = Object.fromEntries(questionKeys.map(k => [k, false]));
const input = (patch = {}) => onboardingPreviewSchema.parse({ version: 1, respostas: { ...respostas, ...patch } });
const codes = ["servicos", "reservas", "arena", "ourives", "combos", "restaurante-delivery", "assinaturas", "loja-virtual", "atendimento", "whatsapp", "notas-fiscais"];
const catalog: CatalogModule[] = codes.map((codigo, id) => ({ id, codigo, nome: codigo, preco: id < 5 ? 0 : 19.9, status: true }));
test("business profiles map to real module/menu keys", () => {
  for (const [question, code, menu] of [["prestaServicos", "servicos", "servicos"], ["usaAgendamento", "reservas", "reservas"], ["gerenciaQuadras", "arena", "arena"], ["atuaOurivesaria", "ourives", "ourive"], ["operaRestauranteDelivery", "restaurante-delivery", "restaurante"]]) {
    const p = previewOnboarding(input({ [question]: true }), catalog);
    assert.ok(p.menusSugeridos.includes(menu));
    assert.ok(p.modulos.find(m => m.codigo === code)?.selecionado);
  }
  const retail = previewOnboarding(input({ vendeProdutos: true }), catalog);
  assert.ok(retail.menusEfetivos.includes("vendas"));
  assert.ok(retail.menusEfetivos.includes("produtos"));
});
test("hybrid business suggests all relevant apps, paid apps only recommend", () => {
  const p = previewOnboarding(input(Object.fromEntries(questionKeys.map(k => [k, true]))), catalog);
  assert.equal(p.modulos.filter(m => m.selecionado).length, codes.length);
  assert.equal(p.modulos.find(m => m.codigo === "restaurante-delivery")?.acao, "RECOMENDAR_CONTRATACAO");
  assert.equal(p.modulos.find(m => m.codigo === "arena")?.acao, "ATIVAR_GRATUITO");
});
test("essential menus survive explicit empty selection and submenu keys stay blacklist", () => {
  const p = previewOnboarding({ ...input(), modulosSelecionados: ["combos"], menusSelecionados: ["produtos:combos", "servicos:os"] }, catalog);
  for (const menu of baseMenuKeys) assert.ok(p.menusEfetivos.includes(menu));
  assert.ok(p.menusEfetivos.includes("produtos"));
  assert.ok(!p.menusEfetivos.includes("produtos:combos"));
  assert.ok(p.menusEfetivos.includes("servicos:os"));
  assert.ok(previewOnboarding(input(), catalog).menusEfetivos.includes("produtos:combos"));
});
test("selection is editable; no negative answer cancels or creates paid contracts", () => {
  const p = previewOnboarding({ ...input({ gerenciaQuadras: true }), modulosSelecionados: ["whatsapp"] }, catalog);
  assert.equal(p.modulos.find(m => m.codigo === "arena")?.acao, "NAO_SELECIONADO");
  assert.equal(p.modulos.find(m => m.codigo === "whatsapp")?.acao, "RECOMENDAR_CONTRATACAO");
});
test("stale catalog detects free-to-paid, disabled, deleted and other price changes", () => {
  const i = { ...input(), modulosSelecionados: ["arena"], catalogVersion: catalogVersion(catalog) };
  for (const changed of [catalog.map(m => m.codigo === "arena" ? { ...m, preco: 9 } : m), catalog.map(m => m.codigo === "arena" ? { ...m, status: false } : m), catalog.filter(m => m.codigo !== "arena")]) assert.throws(() => previewOnboarding(i, changed), OnboardingCatalogChanged);
  assert.throws(() => previewOnboarding({ ...input(), modulosSelecionados: ["unknown"] }, catalog), OnboardingCatalogChanged);
  assert.doesNotThrow(() => previewOnboarding(input({ gerenciaQuadras: true }), []));
});
test("public config has safe fields and validated theme presets", () => {
  const config = onboardingConfig(catalog);
  assert.equal(config.questions.length, 12);
  assert.equal(config.modules.find(m => m.codigo === "ourives")?.menuKey, "ourive");
  assert.equal(config.modules.find(m => m.codigo === "restaurante-delivery")?.ativacaoNoCadastro, false);
  for (const preset of config.themePresets) assert.ok(onboardingCadastroSchema.safeParse({ ...input(), modulosSelecionados: [], menusSelecionados: [], temaPersonalizado: preset.tema, catalogVersion: catalogVersion(catalog) }).success);
  assert.ok(!JSON.stringify(config.modules).includes('"id":'));
});
test("schema rejects client commercial fields, non-booleans, unknown menus and unsafe themes", () => {
  assert.equal(onboardingPreviewSchema.safeParse({ ...input(), preco: 0 }).success, false);
  assert.equal(onboardingPreviewSchema.safeParse({ ...input(), respostas: { ...respostas, vendeProdutos: "false" } }).success, false);
  assert.equal(onboardingPreviewSchema.safeParse({ ...input(), menusSelecionados: ["admin"] }).success, false);
  const valid = { ...input(), modulosSelecionados: [], menusSelecionados: [], temaPersonalizado: onboardingConfig(catalog).themePresets[0].tema, catalogVersion: catalogVersion(catalog) };
  const { catalogVersion: _version, ...missingVersion } = valid;
  assert.equal(onboardingCadastroSchema.safeParse(missingVersion).success, false);
  for (const patch of [{ fonte: "Comic Sans" }, { radius: "url(x)" }, { primariaLight: "red" }, { tamanhoFonte: "999%" }, { site: {} }]) assert.equal(onboardingCadastroSchema.safeParse({ ...valid, temaPersonalizado: { ...valid.temaPersonalizado, ...patch } }).success, false);
});
test("activation writes only enabled free apps in supplied transaction, never paid or billing", async () => {
  const writes: unknown[] = [];
  const tx = { moduloOnConta: { create: async (args: unknown) => { writes.push(args); } } } as unknown as Pick<Prisma.TransactionClient, "moduloOnConta">;
  const p = previewOnboarding(input({ gerenciaQuadras: true, operaRestauranteDelivery: true }), catalog);
  const vencimento = new Date("2026-11-01T00:00:00Z");
  await activateFreeOnboardingModules(tx, 41, vencimento, p, catalog);
  assert.deepEqual(writes, [{ data: { contaId: 41, moduloId: 2, vencimento, valorAdicional: 0, status: "ATIVO" } }]);
  await assert.rejects(() => activateFreeOnboardingModules(tx, 41, vencimento, p, catalog.map(m => ({ ...m, preco: 1 }))), OnboardingCatalogChanged);
});
test("transaction failures propagate so caller can roll back account creation", async () => {
  const tx = { moduloOnConta: { create: async () => { throw new Error("insert failed"); } } } as unknown as Pick<Prisma.TransactionClient, "moduloOnConta">;
  await assert.rejects(() => activateFreeOnboardingModules(tx, 1, new Date(), previewOnboarding(input({ gerenciaQuadras: true }), catalog), catalog), /insert failed/);
});
