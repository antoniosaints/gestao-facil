import assert from "node:assert/strict";
import test from "node:test";
import { D2TI_SAO_MATEUS } from "./d2tiSaoMateus";
import { resolveNfseProvider, selectedNfseMode } from "./providerResolver";

test("configurações NACIONAL anteriores passam a usar a Geranet", () => {
  const config = { codigoMunicipioIbge: D2TI_SAO_MATEUS.codigoIbge, modoEmissaoNfse: "NACIONAL" };
  assert.equal(selectedNfseMode(config), "GERANET");
  assert.deepEqual(resolveNfseProvider(config), { mode: "GERANET", provider: "GERANET_NFSE" });
});

test("o legado D2TI exige São Mateus do Maranhão", () => {
  assert.deepEqual(resolveNfseProvider({ codigoMunicipioIbge: D2TI_SAO_MATEUS.codigoIbge, modoEmissaoNfse: "LEGADO_D2TI" }), {
    mode: "LEGADO_D2TI",
    provider: D2TI_SAO_MATEUS.provedor,
  });
  assert.throws(() => resolveNfseProvider({ codigoMunicipioIbge: "2100055", modoEmissaoNfse: "LEGADO_D2TI" }), /somente para São Mateus/);
});
