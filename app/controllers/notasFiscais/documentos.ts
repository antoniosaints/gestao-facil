import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { enqueueFiscalEmission } from "../../queues/fiscalEmissionQueue";
import { createFiscalIntentForSale } from "../../services/notasFiscais/fiscalSaleService";
import { fiscalStatusFromProvider } from "../../services/notasFiscais/fiscalProviderPolicy";
import { downloadPlugNotas, requestPlugNotasCancellation } from "../../services/notasFiscais/plugNotas";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";

const types = z.enum(["NFE", "NFCE", "NFSE"]);
const fiscalSaleTypes = z.enum(["NFE", "NFCE"]);
const idSchema = z.coerce.number().int().positive();

function fail(res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: randomUUID() } });
}

function mapDocument(invoice: any) {
  return {
    id: invoice.id, vendaId: invoice.vendaId, tipo: invoice.tipo, modelo: invoice.modelo, status: invoice.status, serie: invoice.serie,
    numero: invoice.numero, chaveAcesso: invoice.chaveAcesso, protocolo: invoice.protocolo, valorTotal: Number(invoice.valorTotal),
    erroMensagem: invoice.erroMensagem, criadoEm: invoice.criadoEm, emitidaEm: invoice.emitidaEm, canceladaEm: invoice.canceladaEm,
    cliente: invoice.Cliente ? { id: invoice.Cliente.id, nome: invoice.Cliente.nome, documento: invoice.Cliente.documento } : null,
    eventos: invoice.Eventos?.map((event: any) => ({ id: event.id, tipo: event.tipo, status: event.status, motivo: event.motivo, createdAt: event.createdAt })) || [],
  };
}

export async function listFiscalDocuments(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const type = req.query.tipo ? types.safeParse(req.query.tipo) : null;
  if (type && !type.success) return fail(res, 422, "fiscal_type_invalid", "Tipo de documento fiscal inválido.");
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const where = { contaId: custom.contaId, ...(type?.success ? { tipo: type.data } : {}) };
  const [items, total] = await Promise.all([
    prisma.notaFiscal.findMany({ where, include: { Cliente: { select: { id: true, nome: true, documento: true } }, Eventos: { orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: { criadoEm: "desc" }, skip: (page - 1) * limit, take: limit }),
    prisma.notaFiscal.count({ where }),
  ]);
  return res.json({ data: items.map(mapDocument), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, requestId: randomUUID() });
}

export async function getFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return fail(res, 422, "fiscal_document_invalid", "Documento fiscal inválido.");
  const item = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId }, include: { Cliente: { select: { id: true, nome: true, documento: true } }, Itens: true, Eventos: { orderBy: { createdAt: "desc" } } } });
  if (!item) return fail(res, 404, "fiscal_document_not_found", "Documento fiscal não encontrado.");
  return res.json({ data: { ...mapDocument(item), itens: item.Itens.map((line) => ({ ...line, quantidade: Number(line.quantidade), valorUnitario: Number(line.valorUnitario), valorTotal: Number(line.valorTotal) })) }, requestId: randomUUID() });
}

export async function createSaleFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const vendaId = idSchema.safeParse(req.params.vendaId);
  const body = z.object({ tipo: fiscalSaleTypes }).safeParse(req.body);
  if (!vendaId.success || !body.success) return fail(res, 422, "fiscal_request_invalid", "Informe uma venda e o tipo NF-e ou NFC-e.");
  const sale = await prisma.vendas.findFirst({
    where: { id: vendaId.data, contaId: custom.contaId },
    select: { status: true },
  });
  if (!sale) return fail(res, 404, "sale_not_found", "Venda não encontrada.");
  if (sale.status !== "FATURADO") {
    return fail(res, 409, "fiscal_sale_not_invoiced", "Fature a venda antes de emitir a nota fiscal.");
  }
  try {
    const invoice = await prisma.$transaction((tx) => createFiscalIntentForSale(tx, { contaId: custom.contaId, vendaId: vendaId.data, tipo: body.data.tipo, idempotencyKey: String(req.headers["idempotency-key"] || "") || undefined }));
    await enqueueFiscalEmission(invoice.id);
    return res.status(201).json({ data: mapDocument(invoice), requestId: randomUUID() });
  } catch (error: any) {
    return fail(res, 422, error?.code || "fiscal_preflight_failed", error?.message || "Não foi possível preparar a emissão fiscal.");
  }
}

export async function retryFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return fail(res, 422, "fiscal_document_invalid", "Documento fiscal inválido.");
  const invoice = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId } });
  if (!invoice) return fail(res, 404, "fiscal_document_not_found", "Documento fiscal não encontrado.");
  if (!["PENDENTE", "FALHA_REPROCESSAVEL"].includes(invoice.status)) return fail(res, 409, "fiscal_retry_not_allowed", "Este documento não pode ser reenviado no estado atual.");
  await enqueueFiscalEmission(invoice.id);
  return res.status(202).json({ data: mapDocument(invoice), requestId: randomUUID() });
}

export async function cancelFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  const body = z.object({ motivo: z.string().trim().min(15).max(500) }).safeParse(req.body);
  if (!id.success || !body.success) return fail(res, 422, "fiscal_cancel_invalid", "Informe uma justificativa de cancelamento com ao menos 15 caracteres.");
  const invoice = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId }, include: { Eventos: true } });
  if (!invoice) return fail(res, 404, "fiscal_document_not_found", "Documento fiscal não encontrado.");
  if (invoice.status !== "AUTORIZADA" || !invoice.provedorId) return fail(res, 409, "fiscal_cancel_not_allowed", "Somente documento autorizado pode ser cancelado.");
  const idempotencyKey = String(req.headers["idempotency-key"] || randomUUID());
  const duplicate = invoice.Eventos.find((event) => event.idempotencyKey === idempotencyKey);
  if (duplicate) return res.status(202).json({ data: { eventoId: duplicate.id, status: duplicate.status }, requestId: randomUUID() });
  const event = await prisma.notaFiscalEvento.create({ data: { notaFiscalId: invoice.id, tipo: "CANCELAMENTO", status: "PROCESSANDO", motivo: body.data.motivo, idempotencyKey } });
  try {
    const response = await requestPlugNotasCancellation(invoice.tipo as "NFE" | "NFCE" | "NFSE", invoice.provedorId, body.data.motivo);
    await prisma.notaFiscalEvento.update({ where: { id: event.id }, data: { respostaJson: response as any, protocolo: String(response?.data?.protocol || response?.protocolo || "") || null } });
    return res.status(202).json({ data: { eventoId: event.id, status: "PROCESSANDO" }, requestId: randomUUID() });
  } catch (error: any) {
    await prisma.notaFiscalEvento.update({ where: { id: event.id }, data: { status: "FALHOU", respostaJson: error?.response?.data || { message: error?.message } } });
    return fail(res, 502, "fiscal_provider_unavailable", "O provedor não confirmou o cancelamento. Consulte o histórico antes de tentar novamente.");
  }
}

export async function downloadFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  const format = z.enum(["xml", "pdf"]).safeParse(req.params.format);
  if (!id.success || !format.success) return fail(res, 422, "fiscal_download_invalid", "Arquivo fiscal inválido.");
  const invoice = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId } });
  if (!invoice?.provedorId) return fail(res, 409, "fiscal_file_unavailable", "O arquivo ainda não está disponível.");
  try {
    const binary = await downloadPlugNotas(invoice.tipo as "NFE" | "NFCE" | "NFSE", invoice.provedorId, format.data);
    res.setHeader("Content-Disposition", `attachment; filename=${invoice.tipo}-${invoice.serie || 1}-${invoice.numero || invoice.id}.${format.data}`);
    res.type(format.data === "xml" ? "application/xml" : "application/pdf");
    return res.send(Buffer.from(binary));
  } catch {
    return fail(res, 502, "fiscal_file_unavailable", "Não foi possível obter o arquivo no provedor.");
  }
}

export async function plugNotasWebhook(req: Request, res: Response) {
  const configured = env.PLUGNOTAS_WEBHOOK_SECRET;
  const supplied = String(req.headers["x-plugnotas-webhook-secret"] || "");
  if (!configured || supplied.length !== configured.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) return fail(res, 401, "fiscal_webhook_unauthorized", "Webhook fiscal não autorizado.");
  const payload = Array.isArray(req.body) ? req.body[0] : req.body?.data || req.body;
  const providerId = String(payload?.id || payload?.idNota || "");
  const integrationId = String(payload?.idIntegracao || "");
  const status = String(payload?.status || payload?.situacao || "").toUpperCase();
  const identifiers = [{ provedorId: providerId }, { idIntegracao: integrationId }].filter((identifier) => Object.values(identifier)[0]);
  if (!identifiers.length) return res.status(202).json({ accepted: true });
  const invoice = await prisma.notaFiscal.findFirst({ where: { OR: identifiers } });
  if (!invoice) return res.status(202).json({ accepted: true });
  const next = fiscalStatusFromProvider(status);
  await prisma.$transaction(async (tx) => {
    await tx.notaFiscal.update({ where: { id: invoice.id }, data: { status: next, provedorId: providerId || invoice.provedorId, chaveAcesso: payload?.chave || invoice.chaveAcesso, protocolo: payload?.protocolo || invoice.protocolo, emitidaEm: next === "AUTORIZADA" ? new Date() : invoice.emitidaEm, canceladaEm: next === "CANCELADA" ? new Date() : invoice.canceladaEm, respostaJson: payload } });
    if (next === "CANCELADA") await tx.notaFiscalEvento.updateMany({ where: { notaFiscalId: invoice.id, tipo: "CANCELAMENTO", status: "PROCESSANDO" }, data: { status: "CONCLUIDO", processadoEm: new Date(), respostaJson: payload } });
  });
  return res.status(204).end();
}
