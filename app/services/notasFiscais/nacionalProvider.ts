import axios from "axios";

export const NACIONAL_NFSE = {
  provider: "NACIONAL",
  parametrosBase: {
    HOMOLOGACAO: "https://adn.producaorestrita.nfse.gov.br/parametrizacao",
    PRODUCAO: "https://adn.nfse.gov.br/parametrizacao",
  },
  sefinBase: {
    HOMOLOGACAO: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
    PRODUCAO: "https://sefin.nfse.gov.br/SefinNacional",
  },
} as const;

type Ambiente = keyof typeof NACIONAL_NFSE.parametrosBase;

export function nationalEndpoints(ambiente: Ambiente) {
  return {
    parametros: NACIONAL_NFSE.parametrosBase[ambiente],
    sefin: NACIONAL_NFSE.sefinBase[ambiente],
  };
}

// O payload completo do município pode evoluir. Preservamos o retorno oficial,
// sem transformá-lo em regras locais que poderiam ficar desatualizadas.
export async function consultarParametrosMunicipaisNacional(codigoMunicipioIbge: string, ambiente: Ambiente) {
  const codigo = String(codigoMunicipioIbge || "").replace(/\D/g, "");
  if (codigo.length !== 7) throw new Error("Informe um código IBGE municipal válido para consultar o Emissor Nacional.");
  const { parametros } = nationalEndpoints(ambiente);
  const response = await axios.get(`${parametros}/parametros_municipais/${codigo}/convenio`, {
    headers: { Accept: "application/json" },
    timeout: 12_000,
  });
  return response.data;
}

export function buildDpsDraft(input: {
  codigoMunicipioIbge: string;
  documentoPrestador: string;
  inscricaoMunicipal: string;
  serie: number;
  numero: number;
  codigoServico?: string | null;
  discriminacao: string;
  valorTotal: number;
}) {
  const documentoOriginal = String(input.documentoPrestador).replace(/\D/g, "");
  const documento = documentoOriginal.padStart(14, "0");
  const identificador = [
    String(input.codigoMunicipioIbge).padStart(7, "0"),
    documentoOriginal.length === 11 ? "1" : "2",
    documento,
    String(input.serie).padStart(5, "0"),
    String(input.numero).padStart(15, "0"),
  ].join("");
  return {
    versaoLeiaute: "DPS_NACIONAL",
    id: identificador,
    municipioEmissorIbge: String(input.codigoMunicipioIbge),
    prestador: { inscricaoMunicipal: input.inscricaoMunicipal, documento },
    identificacaoDps: { serie: input.serie, numero: input.numero },
    servico: { codigo: input.codigoServico || null, discriminacao: input.discriminacao, valor: input.valorTotal },
  };
}
