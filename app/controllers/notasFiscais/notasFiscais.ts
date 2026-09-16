import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { buildScopedUploadKey, deleteStoredFile, uploadPublicFile } from "../../services/uploads/fileStorageService";
import { consultarMunicipiosIbge } from "../../services/notasFiscais/municipios";
import {
  decryptFiscalSecret,
  encryptCertificateBuffer,
  encryptFiscalSecret,
  hasFiscalCertificateEncryptionKey,
} from "../../services/notasFiscais/certificateCrypto";
import { D2TI_SAO_MATEUS, emitirD2ti, isD2tiSaoMateus } from "../../services/notasFiscais/d2tiSaoMateus";
import { resolveNfseProvider, selectedNfseMode } from "../../services/notasFiscais/providerResolver";
import { buildDpsDraft, consultarParametrosMunicipaisNacional, nationalEndpoints } from "../../services/notasFiscais/nacionalProvider";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { getGeranetUser } from "../../services/notasFiscais/geranet";
import { emitGeranetNfse, type GeranetResponse } from "../../services/notasFiscais/geranet";
import { getGeranetCredentials } from "../../services/notasFiscais/fiscalSaleService";
import { storeFiscalArtifact } from "../../services/notasFiscais/fiscalArtifactStorage";

const text = (max = 191) => z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}, z.string().max(max).optional());

const configSchema = z.object({
  razaoSocial: text(), nomeFantasia: text(), documento: text(32), inscricaoEstadual: text(64),
  inscricaoMunicipal: text(64), regimeTributario: z.coerce.number().int().min(0).max(4).default(0),
  codigoMunicipioIbge: text(10), codigoMunicipioPrestador: text(32), municipioNome: text(120),
  uf: z.preprocess((value) => String(value ?? "").trim().toUpperCase() || undefined, z.string().length(2).optional()),
  cep: text(16), logradouro: text(), numero: text(32), bairro: text(120), complemento: text(120),
  email: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().email().optional()),
  telefone: text(32), ambiente: z.enum(["HOMOLOGACAO", "PRODUCAO"]).default("HOMOLOGACAO"),
  nfseHabilitado: z.boolean().default(false), nfeHabilitado: z.boolean().default(false), nfceHabilitado: z.boolean().default(false),
  modoEmissaoNfse: z.enum(["GERANET", "NACIONAL", "LEGADO_D2TI"]).default("GERANET"),
  provedorNfse: text(40).default("GERANET_NFSE"), serieRps: z.coerce.number().int().min(1).max(999).default(1),
  serieNfe: z.coerce.number().int().min(1).max(999).default(1), serieNfce: z.coerce.number().int().min(1).max(999).default(1),
  nfceCscId: text(32), nfceCscToken: text(512),
  nfseCodigoServicoNacional: text(16), nfseCodigoTributacaoMunicipio: text(32), nfseCodigoCnae: text(16),
  nfseDataOpcaoSimples: z.preprocess((value) => value ? new Date(String(value)) : undefined, z.date().optional()),
  nfseRegimeApuracaoSn: z.enum(["1", "2", "3"]).default("1"),
  nfseIssRetido: z.enum(["1", "2", "3"]).default("2"),
  nfseResponsavelRetencao: z.enum(["1", "2", "3", "4"]).default("4"),
  nfseNaturezaOperacao: z.enum(["1", "2", "3", "4", "5", "6", "7", "8"]).default("1"),
  nfseIncentivadorCultural: z.enum(["1", "2"]).default("2"),
  nfseExigibilidadeIss: z.enum(["1", "2", "3", "4", "5", "6", "7", "8"]).default("1"),
  nfseRegimeEspecialTributacao: text(2).default("1"),
  nfeNaturezaOperacao: text(120).default("Venda de mercadoria"),
  nfeTipoAtividade: z.enum(["1", "2", "3", "4", "5"]).default("1"),
  nfeIndicadorPresenca: z.enum(["0", "1", "2", "3", "4", "5", "9"]).default("1"),
  nfeIndicativoIntermediador: z.enum(["0", "1"]).default("0"),
  nfeFrete: z.enum(["0", "1", "2", "3", "4", "9"]).default("9"),
  responsavelTecnicoCnpj: text(14), responsavelTecnicoContato: text(120),
  responsavelTecnicoEmail: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().email().optional()),
  responsavelTecnicoTelefone: text(20), responsavelTecnicoCsrtId: text(10), responsavelTecnicoCsrt: text(512),
  codigoServicoPadrao: text(32), descricaoServicoPadrao: text(250), codigoAtividadePadrao: text(10), descricaoAtividadePadrao: text(250),
  tipoTributacaoPadrao: z.coerce.number().int().min(1).max(9).nullable().optional(), tipoRecolhimentoPadrao: z.coerce.number().int().min(1).max(9).nullable().optional(),
  notaIntermediadaPadrao: z.coerce.number().int().min(1).max(2).default(2), aliquotaIssPadrao: z.coerce.number().min(0).max(100).nullable().optional(),
});

const nfseSchema = z.object({
  clienteId: z.coerce.number().int().positive(),
  valorTotal: z.coerce.number().positive().max(99_999_999),
  codigoServico: text(32),
  discriminacao: z.string().trim().min(3).max(8_000),
});

const d2tiEmissionSchema = z.object({
  clienteId: z.coerce.number().int().positive(),
  valorTotal: z.coerce.number().positive().max(99_999_999),
  codigoServico: text(5),
  codigoMunicipioTomador: z.preprocess((value) => String(value ?? "").replace(/\D/g, ""), z.string().min(3).max(6)),
  discriminacao: z.string().trim().min(3).max(8_000),
});

function requestId(req: Request) {
  return String(req.headers["x-request-id"] || randomUUID());
}

function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });
}

function mapConfig(config: any, conta: any) {
  const value = config || {};
  const d2ti = selectedNfseMode(value) === "LEGADO_D2TI" && value.codigoMunicipioIbge === D2TI_SAO_MATEUS.codigoIbge;
  return {
    razaoSocial: value.razaoSocial ?? conta.nome ?? "",
    nomeFantasia: value.nomeFantasia ?? conta.nomeFantasia ?? "",
    documento: value.documento ?? conta.documento ?? "",
    inscricaoEstadual: value.inscricaoEstadual ?? conta.ie ?? "",
    inscricaoMunicipal: value.inscricaoMunicipal ?? conta.im ?? "",
    regimeTributario: value.regimeTributario ?? conta.regimeTributario ?? 0,
    codigoMunicipioIbge: value.codigoMunicipioIbge ?? "",
    codigoMunicipioPrestador: value.codigoMunicipioPrestador ?? (d2ti ? D2TI_SAO_MATEUS.codigoTom : ""),
    municipioNome: value.municipioNome ?? "",
    uf: value.uf ?? "",
    cep: value.cep ?? conta.cep ?? "",
    logradouro: value.logradouro ?? conta.endereco ?? "",
    numero: value.numero ?? "",
    bairro: value.bairro ?? "",
    complemento: value.complemento ?? "",
    email: value.email ?? conta.email ?? "",
    telefone: value.telefone ?? conta.telefone ?? "",
    ambiente: value.ambiente ?? "HOMOLOGACAO",
    nfseHabilitado: Boolean(value.nfseHabilitado),
    nfeHabilitado: Boolean(value.nfeHabilitado),
    nfceHabilitado: Boolean(value.nfceHabilitado),
    modoEmissaoNfse: d2ti ? "LEGADO_D2TI" : "GERANET",
    provedorNfse: d2ti ? D2TI_SAO_MATEUS.provedor : "GERANET_NFSE",
    serieRps: value.serieRps ?? 1,
    proximoNumeroRps: value.proximoNumeroRps ?? 1,
    serieNfe: value.serieNfe ?? 1,
    proximoNumeroNfe: value.proximoNumeroNfe ?? 1,
    serieNfce: value.serieNfce ?? 1,
    proximoNumeroNfce: value.proximoNumeroNfce ?? 1,
    nfce: { cscId: value.nfceCscId ?? "", cscConfigurado: Boolean(value.nfceCscTokenCifrado) },
    nfse: {
      codigoServicoNacional: value.nfseCodigoServicoNacional ?? "", codigoTributacaoMunicipio: value.nfseCodigoTributacaoMunicipio ?? "", codigoCnae: value.nfseCodigoCnae ?? "",
      dataOpcaoSimples: value.nfseDataOpcaoSimples ? new Date(value.nfseDataOpcaoSimples).toISOString().slice(0, 10) : "",
      regimeApuracaoSn: value.nfseRegimeApuracaoSn ?? "1", issRetido: value.nfseIssRetido ?? "2", responsavelRetencao: value.nfseResponsavelRetencao ?? "4",
      naturezaOperacao: value.nfseNaturezaOperacao ?? "1", incentivadorCultural: value.nfseIncentivadorCultural ?? "2", exigibilidadeIss: value.nfseExigibilidadeIss ?? "1",
      regimeEspecialTributacao: value.nfseRegimeEspecialTributacao ?? "1",
    },
    nfe: {
      naturezaOperacao: value.nfeNaturezaOperacao ?? "Venda de mercadoria",
      tipoAtividade: value.nfeTipoAtividade ?? "1",
      indicadorPresenca: value.nfeIndicadorPresenca ?? "1",
      indicativoIntermediador: value.nfeIndicativoIntermediador ?? "0",
      frete: value.nfeFrete ?? "9",
    },
    responsavelTecnico: {
      cnpj: value.responsavelTecnicoCnpj ?? "", contato: value.responsavelTecnicoContato ?? "",
      email: value.responsavelTecnicoEmail ?? "", telefone: value.responsavelTecnicoTelefone ?? "",
      csrtId: value.responsavelTecnicoCsrtId ?? "", csrtConfigurado: Boolean(value.responsavelTecnicoCsrtCifrado),
    },
    codigoServicoPadrao: value.codigoServicoPadrao ?? "",
    descricaoServicoPadrao: value.descricaoServicoPadrao ?? "",
    codigoAtividadePadrao: value.codigoAtividadePadrao ?? "",
    descricaoAtividadePadrao: value.descricaoAtividadePadrao ?? "",
    tipoTributacaoPadrao: value.tipoTributacaoPadrao ?? null,
    tipoRecolhimentoPadrao: value.tipoRecolhimentoPadrao ?? null,
    notaIntermediadaPadrao: value.notaIntermediadaPadrao ?? 2,
    aliquotaIssPadrao: value.aliquotaIssPadrao == null ? null : Number(value.aliquotaIssPadrao),
    certificado: {
      configurado: Boolean(value.certificadoReferencia && value.certificadoSenhaCifrada),
      nome: value.certificadoNome ?? null,
      atualizadoEm: value.certificadoAtualizadoEm ?? null,
    },
    integracao: {
      tipo: d2ti ? "TOKEN_D2TI" : "CERTIFICADO_A1",
      configurada: d2ti ? Boolean(value.tokenIntegracaoCifrado && hasFiscalCertificateEncryptionKey()) : Boolean(value.certificadoReferencia && value.certificadoSenhaCifrada && hasFiscalCertificateEncryptionKey()),
      atualizadoEm: d2ti ? (value.tokenIntegracaoAtualizadoEm ?? null) : (value.certificadoAtualizadoEm ?? null),
    },
    emissaoNfsePronta: d2ti
      ? Boolean(value.nfseHabilitado && value.razaoSocial && value.documento && value.inscricaoMunicipal && value.codigoMunicipioIbge && value.tokenIntegracaoCifrado && value.codigoServicoPadrao && value.descricaoServicoPadrao && value.codigoAtividadePadrao && value.descricaoAtividadePadrao && value.tipoTributacaoPadrao && value.tipoRecolhimentoPadrao && value.aliquotaIssPadrao != null && hasFiscalCertificateEncryptionKey())
      : Boolean(value.nfseHabilitado && value.razaoSocial && value.documento && value.inscricaoMunicipal && value.codigoMunicipioIbge && value.municipioNome && value.uf && value.cep && value.logradouro && value.numero && value.bairro && value.codigoServicoPadrao && value.nfseCodigoTributacaoMunicipio && value.aliquotaIssPadrao != null && value.certificadoReferencia && value.certificadoSenhaCifrada && hasFiscalCertificateEncryptionKey() && (![1, 4].includes(value.regimeTributario) || value.nfseDataOpcaoSimples)),
    emissaoNfePronta: Boolean(value.nfeHabilitado && value.razaoSocial && value.documento && value.inscricaoEstadual && value.codigoMunicipioIbge && value.municipioNome && value.uf && value.cep && value.logradouro && value.numero && value.bairro && value.regimeTributario >= 1 && value.nfeNaturezaOperacao && value.certificadoReferencia && value.certificadoSenhaCifrada && hasFiscalCertificateEncryptionKey()),
    emissaoNfcePronta: Boolean(value.nfceHabilitado && value.razaoSocial && value.documento && value.inscricaoEstadual && value.codigoMunicipioIbge && value.municipioNome && value.uf && value.cep && value.logradouro && value.numero && value.bairro && value.regimeTributario >= 1 && value.nfeNaturezaOperacao && value.certificadoReferencia && value.certificadoSenhaCifrada && value.nfceCscId && value.nfceCscTokenCifrado && hasFiscalCertificateEncryptionKey()),
  };
}

export async function getFiscalConfig(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const [config, conta] = await Promise.all([
    prisma.notaFiscalConfiguracao.findUnique({ where: { contaId } }),
    prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
      select: { nome: true, nomeFantasia: true, documento: true, ie: true, im: true, regimeTributario: true, cep: true, endereco: true, email: true, telefone: true },
    }),
  ]);
  return res.json({ data: mapConfig(config, conta), requestId: requestId(req) });
}

export async function saveFiscalConfig(req: Request, res: Response) {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Revise os dados fiscais informados.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const data = parsed.data;
  const nfceCscToken = data.nfceCscToken;
  const responsavelTecnicoCsrt = data.responsavelTecnicoCsrt;
  delete (data as any).nfceCscToken;
  delete (data as any).responsavelTecnicoCsrt;
  if (data.modoEmissaoNfse === "LEGADO_D2TI" && data.codigoMunicipioIbge !== D2TI_SAO_MATEUS.codigoIbge) {
    return fail(req, res, 422, "legacy_provider_unavailable", "O emissor legado D2TI está disponível somente para São Mateus do Maranhão - MA.");
  }
  if (data.modoEmissaoNfse === "LEGADO_D2TI") {
    data.provedorNfse = D2TI_SAO_MATEUS.provedor;
    data.codigoMunicipioPrestador = D2TI_SAO_MATEUS.codigoTom;
    data.municipioNome = "São Mateus do Maranhão";
    data.uf = "MA";
  } else {
    data.modoEmissaoNfse = "GERANET";
    data.provedorNfse = "GERANET_NFSE";
    data.codigoMunicipioPrestador = "";
  }
  const config = await prisma.notaFiscalConfiguracao.upsert({
    where: { contaId },
    create: { contaId, ...data, aliquotaIssPadrao: data.aliquotaIssPadrao ?? null, ...(nfceCscToken ? { nfceCscTokenCifrado: encryptFiscalSecret(nfceCscToken) } : {}), ...(responsavelTecnicoCsrt ? { responsavelTecnicoCsrtCifrado: encryptFiscalSecret(responsavelTecnicoCsrt) } : {}) },
    update: { ...data, aliquotaIssPadrao: data.aliquotaIssPadrao ?? null, ...(nfceCscToken ? { nfceCscTokenCifrado: encryptFiscalSecret(nfceCscToken) } : {}), ...(responsavelTecnicoCsrt ? { responsavelTecnicoCsrtCifrado: encryptFiscalSecret(responsavelTecnicoCsrt) } : {}) },
  });
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: contaId },
    select: { nome: true, nomeFantasia: true, documento: true, ie: true, im: true, regimeTributario: true, cep: true, endereco: true, email: true, telefone: true },
  });
  return res.json({ data: mapConfig(config, conta), requestId: requestId(req) });
}

/** Checagem sem segredo no navegador; o retorno da Geranet não é repassado. */
export async function getGeranetIntegrationStatus(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId } });
  const local = mapConfig(config, { nome: "", nomeFantasia: "", documento: "", ie: "", im: "", regimeTributario: 0, cep: "", endereco: "", email: "", telefone: "" });
  try {
    await getGeranetUser();
    return res.json({ data: { apiKeyValida: true, certificadoConfigurado: local.certificado.configurado, nfsePronta: local.emissaoNfsePronta, nfePronta: local.emissaoNfePronta, nfcePronta: local.emissaoNfcePronta }, requestId: requestId(req) });
  } catch (error: any) {
    return res.status(503).json({ data: { apiKeyValida: false, certificadoConfigurado: local.certificado.configurado, nfsePronta: local.emissaoNfsePronta, nfePronta: local.emissaoNfePronta, nfcePronta: local.emissaoNfcePronta, motivo: error?.response?.status === 401 ? "API Key Geranet inválida." : "Geranet indisponível." }, requestId: requestId(req) });
  }
}

export async function uploadFiscalCertificate(req: Request, res: Response) {
  if (!req.file) return fail(req, res, 400, "certificate_missing", "Envie um certificado A1 (.pfx ou .p12).");
  if (!hasFiscalCertificateEncryptionKey()) {
    return fail(req, res, 503, "certificate_encryption_unavailable", "A criptografia fiscal ainda não está configurada neste ambiente.");
  }
  const senha = String(req.body?.senha ?? "");
  if (senha.length < 1 || senha.length > 512) return fail(req, res, 422, "validation_error", "Informe a senha do certificado.");

  const { contaId } = getCustomRequest(req).customData;
  const previous = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { certificadoReferencia: true } });
  const extension = req.file.originalname.toLowerCase().endsWith(".p12") ? "p12" : "pfx";
  const key = buildScopedUploadKey(contaId, "notas-fiscais/certificados", `a1-${randomUUID()}.${extension}.enc`);
  const stored = await uploadPublicFile({
    key,
    body: encryptCertificateBuffer(req.file.buffer),
    contentType: "application/octet-stream",
    cacheControl: "no-store",
  });

  try {
    await prisma.notaFiscalConfiguracao.upsert({
      where: { contaId },
      create: {
        contaId,
        certificadoReferencia: stored.reference,
        certificadoNome: req.file.originalname.slice(0, 191),
        certificadoSenhaCifrada: encryptFiscalSecret(senha),
        certificadoAtualizadoEm: new Date(),
      },
      update: {
        certificadoReferencia: stored.reference,
        certificadoNome: req.file.originalname.slice(0, 191),
        certificadoSenhaCifrada: encryptFiscalSecret(senha),
        certificadoAtualizadoEm: new Date(),
      },
    });
  } catch (error) {
    await deleteStoredFile(stored.reference).catch(() => undefined);
    throw error;
  }
  if (previous?.certificadoReferencia && previous.certificadoReferencia !== stored.reference) {
    await deleteStoredFile(previous.certificadoReferencia).catch(() => undefined);
  }
  return res.status(201).json({
    data: { configurado: true, nome: req.file.originalname, atualizadoEm: new Date() },
    requestId: requestId(req),
  });
}

export async function saveD2tiToken(req: Request, res: Response) {
  const token = String(req.body?.token ?? "").trim().toUpperCase();
  if (!/^[A-F0-9]{32}$/.test(token)) {
    return fail(req, res, 422, "validation_error", "Informe o token D2TI de 32 caracteres gerado no portal da prefeitura.");
  }
  if (!hasFiscalCertificateEncryptionKey()) {
    return fail(req, res, 503, "credential_encryption_unavailable", "A criptografia fiscal ainda não está configurada neste ambiente.");
  }
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { codigoMunicipioIbge: true, modoEmissaoNfse: true, provedorNfse: true } });
  if (!isD2tiSaoMateus(config || {})) {
    return fail(req, res, 422, "provider_mismatch", "O token D2TI só pode ser configurado para São Mateus do Maranhão - MA.");
  }
  await prisma.notaFiscalConfiguracao.update({
    where: { contaId },
    data: { tokenIntegracaoCifrado: encryptFiscalSecret(token), tokenIntegracaoAtualizadoEm: new Date() },
  });
  return res.status(201).json({ data: { configurado: true, atualizadoEm: new Date() }, requestId: requestId(req) });
}

export async function listMunicipios(req: Request, res: Response) {
  try {
    const data = await consultarMunicipiosIbge(String(req.query.uf || ""), String(req.query.busca || ""));
    return res.json({ data, fonte: "IBGE", requestId: requestId(req) });
  } catch (error: any) {
    return fail(req, res, 422, "municipio_lookup_error", error.message || "Não foi possível consultar municípios.");
  }
}

export async function getNationalMunicipalParameters(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { codigoMunicipioIbge: true, ambiente: true, modoEmissaoNfse: true, provedorNfse: true } });
  if (!config || selectedNfseMode(config) !== "NACIONAL") {
    return fail(req, res, 422, "provider_mismatch", "Selecione o Emissor Nacional para consultar os parâmetros municipais.");
  }
  try {
    const data = await consultarParametrosMunicipaisNacional(config.codigoMunicipioIbge || "", config.ambiente as "HOMOLOGACAO" | "PRODUCAO");
    return res.json({ data, fonte: nationalEndpoints(config.ambiente as "HOMOLOGACAO" | "PRODUCAO").parametros, requestId: requestId(req) });
  } catch (error: any) {
    const status = error?.response?.status === 404 ? 422 : 503;
    return fail(req, res, status, "national_municipal_parameters_unavailable", "Não foi possível obter os parâmetros municipais do Emissor Nacional agora.", { codigoMunicipioIbge: config.codigoMunicipioIbge });
  }
}

export async function listNfse(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
  const [items, total] = await Promise.all([
    prisma.notaFiscal.findMany({
      where: { contaId, tipo: "NFSE" },
      include: { Cliente: { select: { id: true, nome: true, documento: true } } },
      orderBy: { criadoEm: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notaFiscal.count({ where: { contaId, tipo: "NFSE" } }),
  ]);
  return res.json({
    data: items.map((item) => ({
      ...item,
      valorTotal: Number(item.valorTotal),
      cliente: item.Cliente,
      Cliente: undefined,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    requestId: requestId(req),
  });
}

// Gera o RPS e a auditoria de uma NFS-e. A transmissão efetiva depende do adaptador
// municipal/nacional homologado, mas a numeração e os dados ficam imutáveis por conta.
export async function createNfseRps(req: Request, res: Response) {
  const parsed = nfseSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Revise os dados da NFS-e.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const currentConfig = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { modoEmissaoNfse: true, provedorNfse: true } });
  if (selectedNfseMode(currentConfig || {}) === "GERANET") return emitNfseGeranet(req, res);
  const input = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
    const [config, cliente] = await Promise.all([
      tx.notaFiscalConfiguracao.findUnique({ where: { contaId } }),
      tx.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId }, select: { id: true } }),
    ]);
    if (!cliente) throw new Error("Cliente não encontrado nesta conta.");
    if (selectedNfseMode(config || {}) !== "GERANET") throw new Error("Selecione a Geranet para gerar uma NFS-e.");
    if (!config?.razaoSocial || !config.documento || !config.inscricaoMunicipal || !config.codigoMunicipioIbge || !config.certificadoReferencia || !config.certificadoSenhaCifrada) {
      throw new Error("Conclua a configuração fiscal, incluindo inscrição municipal, município e certificado A1, antes de gerar a NFS-e.");
    }
    if (!config?.nfseHabilitado) throw new Error("Ative a NFS-e nas configurações fiscais antes de emitir.");
    const rpsNumero = config.proximoNumeroRps;
    await tx.notaFiscalConfiguracao.update({ where: { contaId }, data: { proximoNumeroRps: { increment: 1 } } });
    return tx.notaFiscal.create({
      data: {
        contaId,
        tipo: "NFSE",
        clienteId: input.clienteId,
        valorTotal: input.valorTotal,
        status: "PRONTA_PARA_EMISSAO",
        ambiente: config.ambiente,
        provedor: config.provedorNfse,
        rpsNumero: String(rpsNumero),
        codigoServico: input.codigoServico || config.codigoServicoPadrao || null,
        discriminacao: input.discriminacao,
        requisicaoJson: {
          provider: "GERANET_NFSE",
          dps: buildDpsDraft({ codigoMunicipioIbge: config.codigoMunicipioIbge, documentoPrestador: config.documento, inscricaoMunicipal: config.inscricaoMunicipal, serie: config.serieRps, numero: rpsNumero, codigoServico: input.codigoServico || config.codigoServicoPadrao, discriminacao: input.discriminacao, valorTotal: input.valorTotal }),
        },
      },
    });
    });
    return res.status(201).json({ data: { ...result, valorTotal: Number(result.valorTotal) }, requestId: requestId(req) });
  } catch (error: any) {
    return fail(req, res, 422, "nfse_rps_invalid", error?.message || "Não foi possível gerar a RPS.");
  }
}

// Mantém a rota estável e resolve o provider pela configuração salva da conta.
// A D2TI permanece somente para notas antigas do município; os novos envios
// seguem pela Geranet em operação síncrona e idempotente.
export async function emitNfse(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { codigoMunicipioIbge: true, modoEmissaoNfse: true, provedorNfse: true, nfseHabilitado: true } });
  if (!config) return fail(req, res, 422, "fiscal_config_incomplete", "Conclua a configuração fiscal antes de emitir a NFS-e.");
  if (!config.nfseHabilitado) return fail(req, res, 422, "fiscal_document_disabled", "Ative a NFS-e nas configurações fiscais antes de emitir.");
  try {
    if (resolveNfseProvider(config).mode === "LEGADO_D2TI") return emitNfseD2ti(req, res);
  } catch (error: any) {
    return fail(req, res, 422, "provider_not_supported", error.message || "O provider selecionado não está disponível para este município.");
  }
  return emitNfseGeranet(req, res);
}

function onlyDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function splitPhone(value: string | null | undefined) {
  const phone = onlyDigits(value);
  return phone.length >= 10 ? phone : undefined;
}

function fiscalInvoiceDto(invoice: any) {
  return { ...invoice, valorTotal: Number(invoice.valorTotal), Cliente: undefined, cliente: invoice.Cliente };
}

function decimalNfse(value: unknown) {
  return Number(value || 0).toFixed(2);
}

function ymd(value?: Date | string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : undefined;
}

function cleanGeranetResponse(response: GeranetResponse) {
  const { xml: _xml, pdf: _pdf, ...safe } = response;
  return safe;
}

function sameCity(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

async function geranetTomadorMunicipio(cliente: any) {
  if (!cliente.cidade || !cliente.estado) throw new Error("O tomador precisa de cidade e UF para emitir a NFS-e.");
  const municipalities = await consultarMunicipiosIbge(cliente.estado, cliente.cidade);
  const municipality = municipalities.find((item) => sameCity(item.nome) === sameCity(cliente.cidade));
  if (!municipality) throw new Error("Não foi possível identificar o código IBGE do município do tomador.");
  return municipality.codigoIbge;
}

function geranetPrestador(config: any) {
  return {
    cnpj: onlyDigits(config.documento), inscricaoMunicipal: config.inscricaoMunicipal, razaoSocial: config.razaoSocial,
    nomeFantasia: config.nomeFantasia || "", endereco: config.logradouro, numero: config.numero,
    complemento: config.complemento || "", bairro: config.bairro, municipio: config.codigoMunicipioIbge,
    nomeMunicipio: config.municipioNome, uf: config.uf, cep: onlyDigits(config.cep), telefone: splitPhone(config.telefone) || "", email: config.email || "",
  };
}

export async function emitNfseGeranet(req: Request, res: Response) {
  const parsed = nfseSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Revise os dados da NFS-e.", parsed.error.flatten());
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 191) return fail(req, res, 400, "idempotency_key_required", "Envie uma chave de idempotência entre 16 e 191 caracteres para emitir a NFS-e.");
  const { contaId } = getCustomRequest(req).customData;
  const input = parsed.data;
  const [config, cliente] = await Promise.all([
    prisma.notaFiscalConfiguracao.findUnique({ where: { contaId } }),
    prisma.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId }, select: { id: true, nome: true, documento: true, im: true, endereco: true, numero: true, bairro: true, complemento: true, cep: true, cidade: true, estado: true, email: true, telefone: true } }),
  ]);
  if (!cliente) return fail(req, res, 422, "tomador_not_found", "Tomador não encontrado nesta conta.");
  if (!config || selectedNfseMode(config) !== "GERANET" || !config.nfseHabilitado) return fail(req, res, 422, "provider_not_supported", "Ative a NFS-e e selecione a Geranet nas configurações fiscais.");
  const simplesNacional = [1, 4].includes(config.regimeTributario) ? "1" : "2";
  const missingConfig = !config.razaoSocial || !config.documento || !config.inscricaoMunicipal || !config.codigoMunicipioIbge || !config.municipioNome || !config.uf || !config.logradouro || !config.numero || !config.bairro || !config.cep || !config.codigoServicoPadrao || !config.nfseCodigoTributacaoMunicipio || config.aliquotaIssPadrao == null || !config.certificadoReferencia || !config.certificadoSenhaCifrada || (simplesNacional === "1" && !config.nfseDataOpcaoSimples);
  if (missingConfig) return fail(req, res, 422, "fiscal_config_incomplete", "Conclua os dados cadastrais, códigos de serviço Geranet, alíquota, A1 e data de opção do Simples quando aplicável.");
  const missingTomador = !cliente.documento || !cliente.endereco || !cliente.numero || !cliente.bairro || !cliente.cep || !cliente.cidade || !cliente.estado;
  if (missingTomador) return fail(req, res, 422, "tomador_incomplete", "O tomador precisa de CPF/CNPJ, endereço, número, bairro, CEP, cidade e UF.");

  let invoice = await prisma.notaFiscal.findUnique({ where: { contaId_idempotencyKey: { contaId, idempotencyKey } }, include: { Cliente: { select: { id: true, nome: true, documento: true } } } });
  if (invoice) {
    if (invoice.status === "EMISSAO_INCERTA") return fail(req, res, 409, "emission_uncertain", "A Geranet não confirmou esta tentativa. Consulte o portal antes de emitir novamente para evitar duplicidade.", { notaFiscalId: invoice.id });
    if (invoice.status === "EMITINDO") return fail(req, res, 409, "emission_in_progress", "Esta NFS-e já está em processamento.", { notaFiscalId: invoice.id });
    return res.json({ data: fiscalInvoiceDto(invoice), requestId: requestId(req) });
  }

  let codigoMunicipioTomador: string;
  try {
    codigoMunicipioTomador = await geranetTomadorMunicipio(cliente);
  } catch (error: any) {
    return fail(req, res, 422, "tomador_municipio_invalid", error?.message || "Não foi possível identificar o município do tomador.");
  }
  const codigoServico = input.codigoServico || config.codigoServicoPadrao;
  const prestador = geranetPrestador(config);
  try {
    // A numeração do RPS nunca é reutilizada, inclusive em concorrência ou
    // quando uma tentativa posterior é rejeitada pelo autorizador.
    const reserved = await prisma.notaFiscalConfiguracao.update({ where: { contaId }, data: { proximoNumeroRps: { increment: 1 } }, select: { proximoNumeroRps: true } });
    const rpsNumero = reserved.proximoNumeroRps - 1;
    invoice = await prisma.notaFiscal.create({
      data: {
        contaId, tipo: "NFSE", clienteId: cliente.id, valorTotal: input.valorTotal, status: "EMITINDO", idempotencyKey, ambiente: config.ambiente,
        provedor: "GERANET_NFSE", rpsNumero: String(rpsNumero), codigoServico, discriminacao: input.discriminacao,
        emitenteSnapshotJson: prestador, destinatarioSnapshotJson: { ...cliente, codigoMunicipioIbge: codigoMunicipioTomador },
        requisicaoJson: { provider: "GERANET_NFSE", serie: config.serieRps, numeroRps: rpsNumero, codigoServicoNacional: config.nfseCodigoServicoNacional, codigoTributacaoMunicipio: config.nfseCodigoTributacaoMunicipio, codigoCnae: config.nfseCodigoCnae },
      },
      include: { Cliente: { select: { id: true, nome: true, documento: true } } },
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const existing = await prisma.notaFiscal.findUnique({ where: { contaId_idempotencyKey: { contaId, idempotencyKey } }, include: { Cliente: { select: { id: true, nome: true, documento: true } } } });
    if (!existing) throw error;
    return res.json({ data: fiscalInvoiceDto(existing), requestId: requestId(req) });
  }

  try {
    const credentials = await getGeranetCredentials(invoice);
    const response = await emitGeranetNfse({
      acao: "emitir", modeloDocumento: "nfse", nomeSistema: "Gestão Fácil", certificadoDigital: credentials.hex, senhaCertificadoDigital: credentials.password,
      padraoNacional: "sim", ambiente: config.ambiente === "PRODUCAO" ? "1" : "2", numeroLote: String(invoice.id), numeroRps: invoice.rpsNumero, serie: String(config.serieRps), simplesNacional,
      ...(simplesNacional === "1" ? { dataOpcaoSimples: ymd(config.nfseDataOpcaoSimples), regimeApuracaoSN: config.nfseRegimeApuracaoSn || "1" } : {}),
      tipo: "1", naturezaOperacao: config.nfseNaturezaOperacao || "1", incentivadorCultural: config.nfseIncentivadorCultural || "2", regimeEspecialTributacao: config.nfseRegimeEspecialTributacao || "1", prestador,
      tomador: { cpfCnpj: onlyDigits(cliente.documento), inscricaoMunicipal: cliente.im || "", razaoSocial: cliente.nome, endereco: cliente.endereco, numero: cliente.numero, complemento: cliente.complemento || "", bairro: cliente.bairro, municipio: codigoMunicipioTomador, nomeMunicipio: cliente.cidade, uf: cliente.estado.toUpperCase(), codigoPais: "1058", pais: "Brasil", cep: onlyDigits(cliente.cep), telefone: splitPhone(cliente.telefone) || "", email: cliente.email || "", substitutoTributario: "2" },
      servico: { valor: decimalNfse(input.valorTotal), deducoes: "0.00", aliquotaPis: "0.00", aliquotaCofins: "0.00", inss: "0.00", ir: "0.00", csll: "0.00", issRetido: config.nfseIssRetido || "2", valorIssRetido: "0.00", outrasRetencoes: "0.00", descontoIncondicionado: "0.00", descontoCondicionado: "0.00", aliquota: decimalNfse(config.aliquotaIssPadrao), responsavelRetencao: config.nfseResponsavelRetencao || "4", itemListaServico: codigoServico, ...(config.nfseCodigoServicoNacional ? { codigoServicoNacional: config.nfseCodigoServicoNacional } : {}), codigoTributacaoMunicipio: config.nfseCodigoTributacaoMunicipio, ...(config.nfseCodigoCnae ? { codigoCnae: config.nfseCodigoCnae } : {}), discriminacao: input.discriminacao, codigoMunicipio: config.codigoMunicipioIbge, municipioIncidencia: config.codigoMunicipioIbge, descricaoLocalidadeIncidencia: config.municipioNome, exigibilidadeISS: config.nfseExigibilidadeIss || "1", ...(simplesNacional === "1" ? { tributacao: { percentualTributosSimplesNacional: decimalNfse(config.aliquotaIssPadrao) } } : {}) },
    });
    const artifacts: Record<string, string> = {};
    if (response.xml) artifacts.xmlPath = await storeFiscalArtifact({ contaId, notaFiscalId: invoice.id, format: "xml", bytes: Buffer.from(response.xml, "hex") });
    if (response.pdf) artifacts.pdfPath = await storeFiscalArtifact({ contaId, notaFiscalId: invoice.id, format: "pdf", bytes: Buffer.from(response.pdf, "hex") });
    const authorized = response.situacao === "sucesso" && (!response.cstat || String(response.cstat) === "100");
    const updated = await prisma.notaFiscal.update({ where: { id: invoice.id }, data: authorized ? { status: "AUTORIZADA", numero: response.numero || null, chaveAcesso: response.chave || null, protocolo: response.protocolo || null, codigoVerificacao: (response as any).codigoVerificacao || null, respostaJson: cleanGeranetResponse(response) as any, erroMensagem: null, emitidaEm: new Date(), ...artifacts } : { status: "REJEITADA", respostaJson: cleanGeranetResponse(response) as any, erroMensagem: response.mensagem || "A Geranet rejeitou a NFS-e." }, include: { Cliente: { select: { id: true, nome: true, documento: true } } } });
    if (!authorized) return fail(req, res, 422, "nfse_rejeitada", response.mensagem || "A Geranet rejeitou a NFS-e.", { notaFiscalId: updated.id });
    return res.status(201).json({ data: fiscalInvoiceDto(updated), requestId: requestId(req) });
  } catch (error: any) {
    const providerResponse = error?.response?.data as GeranetResponse | undefined;
    const status = providerResponse ? "REJEITADA" : "EMISSAO_INCERTA";
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status, respostaJson: providerResponse ? cleanGeranetResponse(providerResponse) as any : undefined, erroMensagem: providerResponse?.mensagem || (status === "EMISSAO_INCERTA" ? "A conexão falhou antes da confirmação; consulte a Geranet antes de tentar novamente." : "A Geranet rejeitou a NFS-e.") } });
    return fail(req, res, providerResponse ? 422 : 502, providerResponse ? "nfse_rejeitada" : "municipal_service_unavailable", providerResponse?.mensagem || "Não foi possível confirmar a emissão na Geranet. A tentativa foi bloqueada para evitar duplicidade.", { notaFiscalId: invoice.id });
  }
}

// A D2TI não usa identificador de RPS. Por isso cada tentativa recebe uma chave de idempotência
// persistida; timeout nunca é reenviado automaticamente, evitando emissão duplicada na prefeitura.
export async function emitNfseD2ti(req: Request, res: Response) {
  const parsed = d2tiEmissionSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Revise os dados da NFS-e.", parsed.error.flatten());
  const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 191) {
    return fail(req, res, 400, "idempotency_key_required", "Envie uma chave de idempotência entre 16 e 191 caracteres para emitir a NFS-e.");
  }
  const { contaId } = getCustomRequest(req).customData;
  const input = parsed.data;
  const [config, cliente] = await Promise.all([
    prisma.notaFiscalConfiguracao.findUnique({ where: { contaId } }),
    prisma.clientesFornecedores.findFirst({ where: { id: input.clienteId, contaId }, select: { id: true, nome: true, documento: true, im: true, endereco: true, numero: true, bairro: true, cep: true, cidade: true, estado: true, email: true, telefone: true } }),
  ]);
  if (!cliente) return fail(req, res, 422, "tomador_not_found", "Tomador não encontrado nesta conta.");
  if (!config || !isD2tiSaoMateus(config)) return fail(req, res, 422, "provider_not_supported", "A emissão automática está homologada apenas para o provedor D2TI de São Mateus do Maranhão - MA.");
  if (!config.tokenIntegracaoCifrado || !hasFiscalCertificateEncryptionKey()) return fail(req, res, 422, "token_required", "Configure o token D2TI protegido antes de emitir.");
  if (config.ambiente === "PRODUCAO" && env.FISCAL_ALLOW_INSECURE_D2TI_HTTP !== "true") {
    return fail(req, res, 503, "insecure_municipal_transport_blocked", "A prefeitura disponibiliza este webservice apenas em HTTP. A emissão em produção está bloqueada até que o administrador autorize explicitamente esse transporte no ambiente.");
  }
  const missingConfig = !config.razaoSocial || !config.documento || !config.inscricaoMunicipal || !config.logradouro || !config.bairro || !config.cep || !config.codigoServicoPadrao || !config.descricaoServicoPadrao || !config.codigoAtividadePadrao || !config.descricaoAtividadePadrao || !config.tipoTributacaoPadrao || !config.tipoRecolhimentoPadrao || config.aliquotaIssPadrao == null;
  if (missingConfig) return fail(req, res, 422, "fiscal_config_incomplete", "Conclua os dados cadastrais e fiscais obrigatórios do provedor D2TI antes de emitir.");
  const missingTomador = !cliente.documento || !cliente.endereco || !cliente.bairro || !cliente.cep || !cliente.cidade || !cliente.estado;
  if (missingTomador) return fail(req, res, 422, "tomador_incomplete", "O tomador precisa de CPF/CNPJ, endereço, bairro, CEP, cidade e UF para esta NFS-e.");

  let invoice = await prisma.notaFiscal.findUnique({ where: { contaId_idempotencyKey: { contaId, idempotencyKey } }, include: { Cliente: { select: { id: true, nome: true, documento: true } } } });
  if (invoice) {
    if (invoice.status === "EMISSAO_INCERTA") return fail(req, res, 409, "emission_uncertain", "A prefeitura não confirmou esta tentativa. Consulte o portal municipal antes de emitir novamente para evitar duplicidade.", { notaFiscalId: invoice.id });
    if (invoice.status === "EMITINDO") return fail(req, res, 409, "emission_in_progress", "Esta NFS-e já está em processamento.", { notaFiscalId: invoice.id });
    return res.json({ data: fiscalInvoiceDto(invoice), requestId: requestId(req) });
  }

  try {
    invoice = await prisma.notaFiscal.create({
      data: {
        contaId, tipo: "NFSE", clienteId: cliente.id, valorTotal: input.valorTotal, status: "EMITINDO", idempotencyKey,
        ambiente: config.ambiente, provedor: D2TI_SAO_MATEUS.provedor, codigoServico: input.codigoServico || config.codigoServicoPadrao,
        discriminacao: input.discriminacao,
        requisicaoJson: { provider: D2TI_SAO_MATEUS.provedor, codigoMunicipioTomador: input.codigoMunicipioTomador },
      },
      include: { Cliente: { select: { id: true, nome: true, documento: true } } },
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const existing = await prisma.notaFiscal.findUnique({ where: { contaId_idempotencyKey: { contaId, idempotencyKey } }, include: { Cliente: { select: { id: true, nome: true, documento: true } } } });
    if (!existing) throw error;
    return res.json({ data: fiscalInvoiceDto(existing), requestId: requestId(req) });
  }

  try {
    const { envelope, result } = await emitirD2ti({
      ambiente: config.ambiente as "HOMOLOGACAO" | "PRODUCAO",
      token: decryptFiscalSecret(config.tokenIntegracaoCifrado),
      prestador: {
        documento: config.documento, inscricaoMunicipal: config.inscricaoMunicipal, razaoSocial: config.razaoSocial,
        logradouro: config.logradouro, complemento: [config.numero, config.complemento].filter(Boolean).join(", "), bairro: config.bairro,
        cep: config.cep, codigoMunicipio: D2TI_SAO_MATEUS.codigoTom, descricaoMunicipio: "SAO MATEUS DO MARANHAO", uf: "MA", descricaoUf: "MARANHAO", email: config.email, telefone: splitPhone(config.telefone),
      },
      tomador: {
        documento: cliente.documento, inscricaoMunicipal: cliente.im, razaoSocial: cliente.nome, logradouro: [cliente.endereco, cliente.numero].filter(Boolean).join(", "), bairro: cliente.bairro,
        cep: cliente.cep, codigoMunicipio: input.codigoMunicipioTomador, descricaoMunicipio: cliente.cidade, uf: cliente.estado.toUpperCase(), descricaoUf: cliente.estado.toUpperCase(), email: cliente.email, telefone: splitPhone(cliente.telefone),
      },
      codigoServico: input.codigoServico || config.codigoServicoPadrao, descricaoServico: config.descricaoServicoPadrao,
      codigoAtividade: config.codigoAtividadePadrao, descricaoAtividade: config.descricaoAtividadePadrao,
      tipoTributacao: config.tipoTributacaoPadrao, tipoRecolhimento: config.tipoRecolhimentoPadrao,
      notaIntermediada: config.notaIntermediadaPadrao, aliquotaIss: Number(config.aliquotaIssPadrao), discriminacao: input.discriminacao, valorTotal: input.valorTotal,
    });
    const updated = await prisma.notaFiscal.update({
      where: { id: invoice.id },
      data: {
        status: result.status, protocolo: result.protocolo, numero: result.numero, codigoVerificacao: result.codigoVerificacao,
        pdfPath: result.pdfUrl, erroMensagem: result.mensagem ?? null, requisicaoJson: { provider: D2TI_SAO_MATEUS.provedor, envelope, codigoMunicipioTomador: input.codigoMunicipioTomador }, respostaJson: { xml: result.respostaXml },
        emitidaEm: result.status === "AUTORIZADA" ? new Date() : null,
      },
      include: { Cliente: { select: { id: true, nome: true, documento: true } } },
    });
    if (result.status === "REJEITADA") return fail(req, res, 422, "nfse_rejeitada", result.mensagem || "A prefeitura rejeitou a NFS-e.", { notaFiscalId: updated.id });
    return res.status(201).json({ data: fiscalInvoiceDto(updated), requestId: requestId(req) });
  } catch (error: any) {
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "EMISSAO_INCERTA", erroMensagem: "A conexão com a prefeitura falhou antes da confirmação. Consulte o portal municipal antes de tentar novamente." } });
    return fail(req, res, 502, "municipal_service_unavailable", "Não foi possível confirmar a emissão com a prefeitura. A tentativa foi bloqueada para evitar duplicidade; consulte o portal municipal.", { notaFiscalId: invoice.id });
  }
}
