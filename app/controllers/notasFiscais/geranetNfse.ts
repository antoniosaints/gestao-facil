import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getGeranetCredentials } from "../../services/notasFiscais/fiscalSaleService";
import { consultGeranetNfse, generateGeranetNfsePdf } from "../../services/notasFiscais/geranet";
import { readFiscalArtifact, storeFiscalArtifact } from "../../services/notasFiscais/fiscalArtifactStorage";
import { buildGeranetNfsePdfPayload, fiscalArtifactBytes } from "../../services/notasFiscais/geranetNfsePolicy";

function fail(res: Response, status: number, code: string, message: string) { return res.status(status).json({ error: { code, message, requestId: randomUUID() } }); }

export async function consultNfseGeranet(req: Request, res: Response) {
  const body = z.object({ ultimoNsu: z.string().regex(/^\d{1,20}$/).default("0"), chaveNfse: z.preprocess(value => String(value ?? "").trim() || undefined, z.string().regex(/^\d{50}$/).optional()) }).safeParse(req.body);
  if (!body.success) return fail(res, 422, "nfse_consult_invalid", "Informe um NSU válido e, se desejar, a chave nacional de 50 dígitos.");
  const { contaId } = getCustomRequest(req).customData;
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId } });
  if (!config?.nfseHabilitado || !config.documento || !config.inscricaoMunicipal || !config.razaoSocial || !/^\d{7}$/.test(config.codigoMunicipioIbge || "")) return fail(res, 422, "nfse_consult_config_incomplete", "Complete os dados do prestador e habilite a NFS-e antes de consultar.");
  try {
    const credentials = await getGeranetCredentials({ contaId });
    const result = await consultGeranetNfse({ prestador: { cnpj: config.documento.replace(/\D/g, ""), inscricaoMunicipal: config.inscricaoMunicipal, razaoSocial: config.razaoSocial, municipio: config.codigoMunicipioIbge }, certificadoDigital: credentials.hex, senhaCertificadoDigital: credentials.password, padraoNacional: "sim", ...body.data });
    if (result?.situacao !== "sucesso" || !Array.isArray(result.registros)) return fail(res, 502, "nfse_consult_failed", result?.mensagem || "A Geranet não confirmou a consulta de notas.");
    // Consulta nacional de DF-es recebidos: não é um comprovante de autorização das emissões locais.
    return res.json({ data: { ultimoNsu: String(result.ultimoNsu ?? body.data.ultimoNsu), maximoNsu: String(result.maximoNsu ?? "0"), proximoNsuSugerido: result.proximoNsuSugerido != null ? String(result.proximoNsuSugerido) : null, temMais: result.temMaisRegistrosProvavelmente === "sim", registros: result.registros }, requestId: randomUUID() });
  } catch { return fail(res, 502, "nfse_consult_unavailable", "Não foi possível consultar as notas na Geranet."); }
}

export async function generateNfseGeranetPdf(req: Request, res: Response) {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return fail(res, 422, "fiscal_document_invalid", "Documento fiscal inválido.");
  const { contaId } = getCustomRequest(req).customData;
  const invoice = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId } });
  if (!invoice || invoice.tipo !== "NFSE" || invoice.provedor !== "GERANET_NFSE" || !invoice.xmlPath || !["AUTORIZADA", "CANCELADA", "HOMOLOGADA"].includes(invoice.status)) return fail(res, 409, "nfse_pdf_unavailable", "Esta NFS-e precisa do XML autorizado para gerar o PDF.");
  try {
    if (!invoice.pdfPath) {
      const xml = await readFiscalArtifact(invoice.xmlPath);
      const result = await generateGeranetNfsePdf(buildGeranetNfsePdfPayload(invoice, xml));
      if (result.situacao !== "sucesso" || !result.pdf) return fail(res, 502, "nfse_pdf_failed", result.mensagem || "A Geranet não retornou o PDF da nota.");
      const reference = await storeFiscalArtifact({ contaId, notaFiscalId: invoice.id, format: "pdf", bytes: fiscalArtifactBytes(result.pdf, "pdf") });
      await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { pdfPath: reference } });
    }
    return res.json({ data: { id: invoice.id, pdfDisponivel: true }, requestId: randomUUID() });
  } catch { return fail(res, 502, "nfse_pdf_unavailable", "Não foi possível gerar o PDF. O status fiscal da nota foi preservado."); }
}
