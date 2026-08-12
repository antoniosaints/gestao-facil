import { D2TI_SAO_MATEUS } from "./d2tiSaoMateus";

export type NfseProviderMode = "NACIONAL" | "LEGADO_D2TI";
export type NfseProviderId = "NACIONAL" | "D2TI_CTA_SAO_MATEUS_MA";

type FiscalProviderConfig = {
  codigoMunicipioIbge?: string | null;
  provedorNfse?: string | null;
  modoEmissaoNfse?: string | null;
};

export function selectedNfseMode(config: FiscalProviderConfig): NfseProviderMode {
  // Compatibilidade para registros anteriores à migration.
  if (config.modoEmissaoNfse === "LEGADO_D2TI" || config.provedorNfse === D2TI_SAO_MATEUS.provedor) return "LEGADO_D2TI";
  return "NACIONAL";
}

export function resolveNfseProvider(config: FiscalProviderConfig): { mode: NfseProviderMode; provider: NfseProviderId } {
  const mode = selectedNfseMode(config);
  if (mode === "LEGADO_D2TI") {
    if (config.codigoMunicipioIbge !== D2TI_SAO_MATEUS.codigoIbge) {
      throw new Error("O emissor legado D2TI está disponível somente para São Mateus do Maranhão - MA.");
    }
    return { mode, provider: D2TI_SAO_MATEUS.provedor };
  }
  return { mode, provider: "NACIONAL" };
}

export function isLegacyD2tiSaoMateus(config: FiscalProviderConfig) {
  return selectedNfseMode(config) === "LEGADO_D2TI" && config.codigoMunicipioIbge === D2TI_SAO_MATEUS.codigoIbge;
}
