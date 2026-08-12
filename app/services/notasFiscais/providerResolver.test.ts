import assert from "node:assert/strict";
import test from "node:test";
import { D2TI_SAO_MATEUS } from "./d2tiSaoMateus";
import { resolveNfseProvider, selectedNfseMode } from "./providerResolver";

test("São Mateus pode optar pelo Emissor Nacional", () => {
  const config = { codigoMunicipioIbge: D2TI_SAO_MATEUS.codigoIbge, modoEmissaoNfse: "NACIONAL" };
  assert.equal(selectedNfseMode(config), "NACIONAL");
  assert.deepEqual(resolveNfseProvider(config), { mode: "NACIONAL", provider: "NACIONAL" });
});

test("o legado D2TI exige São Mateus do Maranhão", () => {
  assert.deepEqual(resolveNfseProvider({ codigoMunicipioIbge: D2TI_SAO_MATEUS.codigoIbge, modoEmissaoNfse: "LEGADO_D2TI" }), {
    mode: "LEGADO_D2TI",
    provider: D2TI_SAO_MATEUS.provedor,
  });
  assert.throws(() => resolveNfseProvider({ codigoMunicipioIbge: "2100055", modoEmissaoNfse: "LEGADO_D2TI" }), /somente para São Mateus/);
});
