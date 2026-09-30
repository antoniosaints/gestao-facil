import { z } from "zod";

const optionalText = (max: number) => z.preprocess(value => String(value ?? "").trim() || undefined, z.string().max(max).optional());
const optionalRate = z.preprocess(value => value === "" || value == null ? undefined : value, z.coerce.number().min(0).max(100).optional());
const numericText = (digits: number) => z.string().regex(new RegExp(`^\\d{${digits}}$`));
const taxRate = z.coerce.number().min(0).max(100);
const ibscbsSchema = z.object({
  finNFSe: z.enum(["0", "1", "2"]), cst: numericText(3), cIndOp: numericText(6),
  tpOper: z.preprocess(value => value || undefined, z.enum(["1", "2", "3", "4", "5"]).optional()),
  indFinal: z.enum(["0", "1"]), indDest: z.enum(["0", "1"]), indOpeOne: z.enum(["0", "1"]),
  ibsEstadual: z.object({ aliquota: taxRate, reducaoAliquota: taxRate }),
  ibsMunicipal: z.object({ aliquota: taxRate, reducaoAliquota: taxRate }),
  cbsFederal: z.object({ aliquota: taxRate, reducaoAliquota: taxRate }),
});
export const geranetNfseSchema = z.object({
  clienteId: z.coerce.number().int().positive(), valorTotal: z.coerce.number().positive().max(99_999_999),
  codigoServico: optionalText(32), discriminacao: z.string().trim().min(3).max(8_000),
  dataCompetencia: z.preprocess(value => value || undefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Informe uma data válida.").optional()),
  codigoClassificacaoTributaria: optionalText(16), ibscbs: ibscbsSchema.optional(),
  codigoNbs: optionalText(16), codigoAnexoCnae: optionalText(16),
  percentualTributosSimplesNacional: optionalRate,
  substitutoTributario: z.enum(["1", "2"]).default("2"),
  municipioIncidencia: z.preprocess(value => value || undefined, z.string().regex(/^\d{7}$/).optional()),
  valorIssRetido: z.preprocess(value => value === "" || value == null ? undefined : value, z.coerce.number().min(0).max(99_999_999).optional()),
});
export type GeranetNfseInput = z.infer<typeof geranetNfseSchema>;
const money = (value: unknown) => Number(value || 0).toFixed(2);

export function validateGeranetNfseRules(config: any, input: GeranetNfseInput, national: boolean, city?: { nome: string; uf: string; provedor: string; versao?: string }) {
  if (!/^\d{7}$/.test(config.codigoMunicipioIbge || "")) return "Informe o código IBGE do prestador com 7 dígitos.";
  if (![1, 2, 3, 4].includes(config.regimeTributario)) return "Informe o regime tributário do prestador.";
  if (national && [1, 4].includes(config.regimeTributario) && input.percentualTributosSimplesNacional == null) return "Informe o percentual total de tributos do Simples Nacional. Ele é diferente da alíquota de ISS.";
  if (config.nfseIssRetido === "1" && (!config.nfseResponsavelRetencao || config.nfseResponsavelRetencao === "4")) return "Informe o responsável pela retenção do ISS nas configurações.";
  if (input.valorIssRetido != null && input.valorIssRetido > input.valorTotal) return "O ISS retido não pode ultrapassar o valor do serviço.";
  if (city?.uf === "PE" && city.nome.toLowerCase() === "petrolina" && city.provedor.toUpperCase() === "EL" && city.versao === "2.04") {
    if (input.codigoNbs) return "O provedor EL 2.04 de Petrolina não aceita o código NBS. Deixe esse campo vazio.";
    if (!/^\d{4}$/.test(input.codigoServico || config.codigoServicoPadrao || "") || !/^\d{6}$/.test(config.nfseCodigoServicoNacional || "")) return "Em Petrolina (EL 2.04), use item da lista com 4 dígitos e código nacional com 6 dígitos.";
  }
  return null;
}

export function buildGeranetNfsePayload(config: any, input: GeranetNfseInput, invoice: any, prestador: any, tomador: any, national: boolean) {
  const simples = [1, 4].includes(config.regimeTributario);
  return {
    acao: "emitir", modeloDocumento: "nfse", nomeSistema: "Gestão Fácil", padraoNacional: national ? "sim" : "nao",
    ambiente: config.ambiente === "PRODUCAO" ? "1" : "2", numeroLote: String(invoice.id), numeroRps: invoice.rpsNumero, serie: String(config.serieRps), simplesNacional: simples ? "1" : "2",
    ...(simples ? { dataOpcaoSimples: new Date(config.nfseDataOpcaoSimples).toISOString().slice(0, 10), regimeApuracaoSN: config.nfseRegimeApuracaoSn || "1" } : {}),
    ...(input.dataCompetencia ? { dataCompetencia: input.dataCompetencia } : {}),
    tipo: "1", naturezaOperacao: config.nfseNaturezaOperacao || "1", incentivadorCultural: config.nfseIncentivadorCultural || "2", regimeEspecialTributacao: config.nfseRegimeEspecialTributacao || "1", prestador,
    tomador: { ...tomador, substitutoTributario: input.substitutoTributario },
    servico: {
      valor: money(input.valorTotal), deducoes: "0.00", aliquotaPis: "0.00", aliquotaCofins: "0.00", inss: "0.00", ir: "0.00", csll: "0.00",
      issRetido: config.nfseIssRetido || "2", valorIssRetido: money(config.nfseIssRetido === "1" ? input.valorIssRetido ?? input.valorTotal * Number(config.aliquotaIssPadrao) / 100 : 0),
      outrasRetencoes: "0.00", descontoIncondicionado: "0.00", descontoCondicionado: "0.00", aliquota: money(config.aliquotaIssPadrao), responsavelRetencao: config.nfseResponsavelRetencao || "4",
      itemListaServico: input.codigoServico || config.codigoServicoPadrao,
      ...(config.nfseCodigoServicoNacional ? { codigoServicoNacional: config.nfseCodigoServicoNacional } : {}),
      codigoTributacaoMunicipio: config.nfseCodigoTributacaoMunicipio,
      ...(config.nfseCodigoCnae ? { codigoCnae: config.nfseCodigoCnae } : {}),
      ...(input.codigoNbs ? { codigoNBS: input.codigoNbs } : {}),
      ...(input.codigoAnexoCnae ? { codigoAnexoCnae: input.codigoAnexoCnae } : {}),
      discriminacao: input.discriminacao, codigoMunicipio: config.codigoMunicipioIbge,
      municipioIncidencia: input.municipioIncidencia || config.codigoMunicipioIbge,
      ...(!input.municipioIncidencia || input.municipioIncidencia === config.codigoMunicipioIbge ? { descricaoLocalidadeIncidencia: config.municipioNome } : {}),
      exigibilidadeISS: config.nfseExigibilidadeIss || "1",
      ...(input.codigoClassificacaoTributaria ? { codigoClassificacaoTributaria: input.codigoClassificacaoTributaria } : {}),
      ...((simples && input.percentualTributosSimplesNacional != null) || input.ibscbs ? { tributacao: {
        ...(simples && input.percentualTributosSimplesNacional != null ? { percentualTributosSimplesNacional: money(input.percentualTributosSimplesNacional) } : {}),
        ...(input.ibscbs ? { ibscbs: {
          ...input.ibscbs,
          ibsEstadual: { percentualIbs: Number(input.ibscbs.ibsEstadual.aliquota).toFixed(4), percentualReducaoAliquota: Number(input.ibscbs.ibsEstadual.reducaoAliquota).toFixed(4) },
          ibsMunicipal: { percentualIbs: Number(input.ibscbs.ibsMunicipal.aliquota).toFixed(4), percentualReducaoAliquota: Number(input.ibscbs.ibsMunicipal.reducaoAliquota).toFixed(4) },
          cbsFederal: { percentualCbs: Number(input.ibscbs.cbsFederal.aliquota).toFixed(4), percentualReducaoAliquota: Number(input.ibscbs.cbsFederal.reducaoAliquota).toFixed(4) },
        } } : {}),
      } } : {}),
    },
  };
}

export function fiscalArtifactBytes(value: string, format: "xml" | "pdf") {
  const trimmed = value.trim();
  const bytes = /^(?:[\da-f]{2})+$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "utf8");
  if (format === "pdf" ? bytes.subarray(0, 5).toString() !== "%PDF-" : !bytes.toString("utf8").trimStart().startsWith("<")) throw new Error(`O provedor retornou ${format.toUpperCase()} inválido.`);
  return bytes;
}

export function buildGeranetNfsePdfPayload(invoice: any, xml: Buffer) {
  const prestador = invoice.emitenteSnapshotJson as any;
  if (!/^\d{7}$/.test(prestador?.municipio || "")) throw new Error("A nota não possui o código IBGE do prestador necessário para gerar o PDF.");
  return { ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", codigoMunicipio: prestador.municipio, nomeSistema: "Gestão Fácil", xml: xml.toString("hex") };
}

export function buildGeranetNfseCancelPayload(invoice: any, xml: Buffer, reason: string, code: string) {
  const prestador = invoice.emitenteSnapshotJson as any;
  if (!/^\d{7}$/.test(prestador?.municipio || "")) throw new Error("A nota não possui o código IBGE do prestador necessário para cancelar.");
  return { acao: "cancelar", modeloDocumento: "nfse", ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", padraoNacional: invoice.requisicaoJson?.padraoNacional === "nao" ? "nao" : "sim", xml: xml.toString("hex"), codigoCancelamento: code, motivoCancelamento: reason, prestador };
}

export function isConfirmedGeranetRejection(error: any) {
  // Um corpo de erro HTTP 5xx não confirma se a prefeitura recebeu a emissão.
  return error?.response?.data?.situacao === "erro" && [400, 422].includes(error.response.status);
}
