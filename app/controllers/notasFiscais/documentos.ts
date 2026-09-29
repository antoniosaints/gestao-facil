import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { enqueueFiscalEmission } from "../../queues/fiscalEmissionQueue";
import { createFiscalIntentForSale, getGeranetCredentials } from "../../services/notasFiscais/fiscalSaleService";
import { fiscalStatusFromProvider } from "../../services/notasFiscais/fiscalProviderPolicy";
import { downloadPlugNotas, requestPlugNotasCancellation } from "../../services/notasFiscais/plugNotas";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { cancelGeranetNfe, cancelGeranetNfse } from "../../services/notasFiscais/geranet";
import { readFiscalArtifact } from "../../services/notasFiscais/fiscalArtifactStorage";
import { Prisma } from "../../../generated";
import { validarCpfCnpj } from "../../helpers/formatters";
import { fiscalRecipientStatus } from "../../services/notasFiscais/fiscalRecipientPolicy";
import { fiscalReportFilters } from "../../services/notasFiscais/fiscalReportFilters";

const fiscalSaleTypes = z.enum(["NFE", "NFCE"]);
const idSchema = z.coerce.number().int().positive();
const batchSaleDocumentsSchema = z.object({ tipo: fiscalSaleTypes, vendaIds: z.array(z.coerce.number().int().positive()).min(1).max(50) });

function fail(res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: randomUUID() } });
}

function mapDocument(invoice: any) {
  const providerFile = !["GERANET_NFE", "GERANET_NFSE"].includes(invoice.provedor || "") && Boolean(invoice.provedorId) && invoice.status === "AUTORIZADA";
  return {
    id: invoice.id, vendaId: invoice.vendaId, vendaUid: invoice.Venda?.Uid || null, tipo: invoice.tipo, modelo: invoice.modelo, status: invoice.status, serie: invoice.serie,
    numero: invoice.numero, chaveAcesso: invoice.chaveAcesso, protocolo: invoice.protocolo, ambiente: invoice.ambiente, valorTotal: Number(invoice.valorTotal),
    rpsNumero: invoice.rpsNumero, codigoServico: invoice.codigoServico, discriminacao: invoice.discriminacao, provedor: invoice.provedor,
    xmlDisponivel: Boolean(invoice.xmlPath) || providerFile, pdfDisponivel: Boolean(invoice.pdfPath) || providerFile,
    erroMensagem: invoice.erroMensagem, criadoEm: invoice.criadoEm, atualizadaEm: invoice.atualizadaEm, emitidaEm: invoice.emitidaEm, canceladaEm: invoice.canceladaEm,
    cliente: invoice.Cliente ? { id: invoice.Cliente.id, nome: invoice.Cliente.nome, documento: invoice.Cliente.documento } : null,
    eventos: invoice.Eventos?.map((event: any) => ({ id: event.id, tipo: event.tipo, status: event.status, motivo: event.motivo, createdAt: event.createdAt })) || [],
  };
}

export async function listFiscalDocuments(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const filters = fiscalReportFilters(req.query);
  if (filters.error) return fail(res, 422, "fiscal_report_filter_invalid", filters.error);
  const requestedPage = Number(req.query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const paginated = req.query.pageSize != null;
  const limit = Math.min(100, Math.max(1, Number(paginated ? req.query.pageSize : req.query.limit) || 20));
  const order = req.query.order === "asc" ? "asc" : "desc";
  const sortBy = String(req.query.sortBy || "criadoEm");
  const allowedSort = ["id", "tipo", "status", "numero", "valorTotal", "criadoEm", "atualizadaEm", "emitidaEm"];
  const orderBy = { [allowedSort.includes(sortBy) && sortBy !== "id" ? sortBy : "criadoEm"]: sortBy === "id" ? "desc" : order } as Prisma.NotaFiscalOrderByWithRelationInput;
  const where: Prisma.NotaFiscalWhereInput = { contaId: custom.contaId, ...filters.where };
  const [items, total] = await Promise.all([
    prisma.notaFiscal.findMany({ where, include: { Cliente: { select: { id: true, nome: true, documento: true } }, Venda: { select: { Uid: true } }, Eventos: { orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: [orderBy, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.notaFiscal.count({ where }),
  ]);
  return res.json({ data: items.map(mapDocument), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, ...(paginated ? { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } : {}), requestId: randomUUID() });
}

export async function summarizeFiscalDocuments(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const filters = fiscalReportFilters(req.query);
  if (filters.error) return fail(res, 422, "fiscal_report_filter_invalid", filters.error);
  const { status: _status, ...withoutStatus } = filters.where;
  const groups = await prisma.notaFiscal.groupBy({ by: ["status"], where: { contaId, ...withoutStatus }, _count: { _all: true }, _sum: { valorTotal: true } });
  const counts = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  const authorized = counts.AUTORIZADA || 0;
  const homologated = counts.HOMOLOGADA || 0;
  const rejected = (counts.REJEITADA || 0) + (counts.FALHA_REPROCESSAVEL || 0);
  const uncertain = (counts.RESULTADO_INCERTO || 0) + (counts.EMISSAO_INCERTA || 0);
  const canceled = counts.CANCELADA || 0;
  return res.json({ data: { total, authorized, homologated, pending: total - authorized - homologated - rejected - uncertain - canceled, uncertain, rejected, canceled, authorizedValue: groups.filter((group) => group.status === "AUTORIZADA").reduce((sum, group) => sum + Number(group._sum.valorTotal || 0), 0), byStatus: counts }, requestId: randomUUID() });
}

export async function fiscalDashboard(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const inicio = String(req.query.inicio || "");
  const fim = String(req.query.fim || "");
  const filters = fiscalReportFilters({ inicio, fim });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim) || filters.error) {
    return fail(res, 422, "fiscal_dashboard_period_invalid", filters.error || "Informe as datas inicial e final do painel.");
  }
  const from = new Date(`${inicio}T00:00:00-03:00`);
  const to = new Date(`${fim}T00:00:00-03:00`);
  to.setUTCDate(to.getUTCDate() + 1);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (days > 366) return fail(res, 422, "fiscal_dashboard_period_too_long", "Selecione um período de até 366 dias.");
  const previousFrom = new Date(from.getTime() - days * 86_400_000);
  const baseWhere: Prisma.NotaFiscalWhereInput = { contaId, criadoEm: { gte: from, lt: to } };
  const [groups, previous, seriesRows, attention] = await Promise.all([
    prisma.notaFiscal.groupBy({ by: ["tipo", "status"], where: baseWhere, _count: { _all: true }, _sum: { valorTotal: true } }),
    prisma.notaFiscal.groupBy({ by: ["status"], where: { contaId, criadoEm: { gte: previousFrom, lt: from } }, _count: { _all: true }, _sum: { valorTotal: true } }),
    prisma.$queryRaw<Array<{ data: string; total: bigint; autorizadas: bigint }>>(Prisma.sql`
      SELECT DATE_FORMAT(DATE_SUB(criadoEm, INTERVAL 3 HOUR), '%Y-%m-%d') AS data, COUNT(*) AS total,
        SUM(CASE WHEN status = 'AUTORIZADA' THEN 1 ELSE 0 END) AS autorizadas
      FROM NotaFiscal WHERE contaId = ${contaId} AND criadoEm >= ${from} AND criadoEm < ${to}
      GROUP BY DATE_FORMAT(DATE_SUB(criadoEm, INTERVAL 3 HOUR), '%Y-%m-%d') ORDER BY data
    `),
    prisma.notaFiscal.findMany({ where: { ...baseWhere, status: { in: ["PENDENTE", "PRONTA_PARA_EMISSAO", "EMITINDO", "EM_PROCESSAMENTO", "FALHA_REPROCESSAVEL", "REJEITADA", "RESULTADO_INCERTO", "EMISSAO_INCERTA"] } }, select: { id: true, tipo: true, status: true, criadoEm: true, erroMensagem: true, Cliente: { select: { nome: true } } }, orderBy: { criadoEm: "asc" }, take: 6 }),
  ]);
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  const authorized = groups.filter((group) => group.status === "AUTORIZADA").reduce((sum, group) => sum + group._count._all, 0);
  const authorizedValue = groups.filter((group) => group.status === "AUTORIZADA").reduce((sum, group) => sum + Number(group._sum.valorTotal || 0), 0);
  const previousTotal = previous.reduce((sum, group) => sum + group._count._all, 0);
  const previousAuthorized = previous.filter((group) => group.status === "AUTORIZADA").reduce((sum, group) => sum + group._count._all, 0);
  const previousValue = previous.filter((group) => group.status === "AUTORIZADA").reduce((sum, group) => sum + Number(group._sum.valorTotal || 0), 0);
  const byStatus = Object.fromEntries(groups.reduce((map, group) => map.set(group.status, (map.get(group.status) || 0) + group._count._all), new Map<string, number>()));
  const byType = Object.fromEntries(groups.reduce((map, group) => map.set(group.tipo, (map.get(group.tipo) || 0) + group._count._all), new Map<string, number>()));
  const series = new Map(seriesRows.map((row) => [row.data, { total: Number(row.total), autorizadas: Number(row.autorizadas) }]));
  const daySeries = Array.from({ length: days }, (_, index) => {
    const date = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
    return { data: date, total: series.get(date)?.total || 0, autorizadas: series.get(date)?.autorizadas || 0 };
  });
  return res.json({ data: {
    kpis: { total, authorized, authorizedValue, approvalRate: total ? Math.round(authorized / total * 1000) / 10 : 0,
      previous: { total: previousTotal, authorized: previousAuthorized, authorizedValue: previousValue } },
    byStatus, byType, series: daySeries,
    attention: attention.map((item) => ({ id: item.id, tipo: item.tipo, status: item.status, criadoEm: item.criadoEm, erroMensagem: item.erroMensagem, cliente: item.Cliente?.nome || "Consumidor final" })),
  }, requestId: randomUUID() });
}

function uninvoicedSalesWhere(contaId: number, search = ""): Prisma.VendasWhereInput {
  return {
    contaId,
    status: "FATURADO",
    NotaFiscals: { none: { status: { notIn: ["REJEITADA", "CANCELADA"] } } },
    ...(search ? { OR: [
      { Uid: { contains: search } },
      { cliente: { nome: { contains: search } } },
      { cliente: { documento: { contains: search } } },
    ] } : {}),
  };
}

function mapUninvoicedSale(sale: any) {
  return { id: sale.id, uid: sale.Uid, valorTotal: Number(sale.valor), data: sale.data, cliente: sale.cliente ? { id: sale.cliente.id, nome: sale.cliente.nome, documento: sale.cliente.documento, documentoValido: fiscalRecipientStatus(sale.cliente) === "DOCUMENTO_VALIDO" } : null };
}

export async function listUninvoicedSales(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const paginated = req.query.pageSize != null;
  const requestedPage = Number(req.query.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const search = String(req.query.search || "").trim().slice(0, 100);
  const order = req.query.order === "desc" ? "desc" : "asc";
  const sortBy = String(req.query.sortBy || "data");
  const orderBy: Prisma.VendasOrderByWithRelationInput = sortBy === "uid" ? { Uid: order } : sortBy === "valorTotal" ? { valor: order } : { data: order };
  const where = uninvoicedSalesWhere(contaId, search);
  const [sales, total] = await Promise.all([
    prisma.vendas.findMany({ where, orderBy, skip: paginated ? (page - 1) * pageSize : 0, take: paginated ? pageSize : limit, include: { cliente: { select: { id: true, nome: true, documento: true } } } }),
    prisma.vendas.count({ where }),
  ]);
  return res.json({ data: sales.map(mapUninvoicedSale), ...(paginated ? { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } : {}), requestId: randomUUID() });
}

export async function selectUninvoicedSales(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const id = req.query.id == null ? null : Number(req.query.id);
  if (id != null && (!Number.isInteger(id) || id < 1)) return res.json({ results: [] });
  const search = String(req.query.search || "").trim().slice(0, 100);
  const sales = await prisma.vendas.findMany({
    where: { ...uninvoicedSalesWhere(contaId, id == null ? search : ""), ...(id == null ? {} : { id }) },
    orderBy: { data: "asc" },
    take: id == null ? 20 : 1,
    include: { cliente: { select: { nome: true, documento: true } } },
  });
  return res.json({ results: sales.map((sale) => {
    const cliente = sale.cliente?.nome || "Consumidor final";
    const documento = ({ SEM_CLIENTE: "Sem cliente vinculado", SEM_DOCUMENTO: "Sem CPF/CNPJ cadastrado", DOCUMENTO_VALIDO: "CPF/CNPJ válido", DOCUMENTO_INVALIDO: "CPF/CNPJ inválido" } as const)[fiscalRecipientStatus(sale.cliente)];
    const label = `${sale.Uid} · ${cliente} · ${documento}`;
    const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(sale.valor));
    return { id: sale.id, label, caminho: `${label} · ${valor}` };
  }) });
}

export async function getFiscalSaleCustomer(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const vendaId = idSchema.safeParse(req.params.vendaId);
  if (!vendaId.success) return fail(res, 422, "fiscal_sale_invalid", "Venda inválida.");
  const sale = await prisma.vendas.findFirst({
    where: { ...uninvoicedSalesWhere(contaId), id: vendaId.data },
    include: { cliente: { select: { id: true, nome: true, documento: true } } },
  });
  if (!sale) return fail(res, 404, "fiscal_sale_not_found", "Venda faturada sem nota ativa não encontrada.");
  return res.json({ data: mapUninvoicedSale(sale), requestId: randomUUID() });
}

export async function linkFiscalSaleCustomer(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const vendaId = idSchema.safeParse(req.params.vendaId);
  const body = z.object({ clienteId: z.coerce.number().int().positive() }).safeParse(req.body);
  if (!vendaId.success || !body.success) return fail(res, 422, "fiscal_sale_customer_invalid", "Informe uma venda e um cliente válidos.");
  const customer = await prisma.clientesFornecedores.findFirst({ where: { id: body.data.clienteId, contaId }, select: { id: true, documento: true } });
  if (!customer) return fail(res, 404, "fiscal_sale_customer_not_found", "Cliente não encontrado nesta conta.");
  if (!validarCpfCnpj(customer.documento || "")) return fail(res, 422, "fiscal_sale_customer_document_invalid", "O cliente precisa ter CPF/CNPJ válido antes de ser vinculado à emissão.");
  const changed = await prisma.vendas.updateMany({
    where: { id: vendaId.data, contaId, status: "FATURADO", NotaFiscals: { none: { status: { notIn: ["REJEITADA", "CANCELADA"] } } } },
    data: { clienteId: customer.id },
  });
  if (!changed.count) return fail(res, 409, "fiscal_sale_customer_link_not_allowed", "Associe o cliente somente a uma venda faturada sem documento fiscal ativo.");
  const sale = await prisma.vendas.findFirst({ where: { id: vendaId.data, contaId }, include: { cliente: { select: { id: true, nome: true, documento: true } } } });
  return res.json({ data: mapUninvoicedSale(sale), requestId: randomUUID() });
}

export async function createSaleFiscalDocumentsBatch(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const body = batchSaleDocumentsSchema.safeParse(req.body);
  if (!body.success) return fail(res, 422, "fiscal_batch_invalid", "Selecione de uma a 50 vendas e o tipo de documento.");
  const result: { emitidas: Array<{ vendaId: number; notaFiscalId: number }>; pendencias: Array<{ vendaId: number; codigo: string; mensagem: string; detalhes?: unknown }> } = { emitidas: [], pendencias: [] };
  for (const vendaId of [...new Set(body.data.vendaIds)]) {
    try {
      const sale = await prisma.vendas.findFirst({ where: { id: vendaId, contaId: custom.contaId }, select: { status: true } });
      if (!sale) throw Object.assign(new Error("Venda não encontrada."), { code: "sale_not_found", status: 404 });
      if (sale.status !== "FATURADO") throw Object.assign(new Error("A venda precisa estar faturada antes da emissão."), { code: "fiscal_sale_not_invoiced", status: 409 });
      const invoice = await prisma.$transaction((tx) => createFiscalIntentForSale(tx, { contaId: custom.contaId, vendaId, tipo: body.data.tipo, idempotencyKey: `lote:${randomUUID()}:${vendaId}` }));
      result.emitidas.push({ vendaId, notaFiscalId: invoice.id });
    } catch (error: any) {
      result.pendencias.push({ vendaId, codigo: error?.code || "fiscal_preflight_failed", mensagem: error?.message || "Não foi possível preparar a emissão.", detalhes: error?.details });
    }
  }
  await Promise.all(result.emitidas.map(({ notaFiscalId }) => enqueueFiscalEmission(notaFiscalId)));
  return res.status(202).json({ data: result, requestId: randomUUID() });
}

export async function getFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return fail(res, 422, "fiscal_document_invalid", "Documento fiscal inválido.");
  const item = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId }, include: { Cliente: { select: { id: true, nome: true, documento: true } }, Venda: { select: { Uid: true } }, Itens: true, Eventos: { orderBy: { createdAt: "desc" } } } });
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
    return fail(res, 422, error?.code || "fiscal_preflight_failed", error?.message || "Não foi possível preparar a emissão fiscal.", error?.details);
  }
}

export async function retryFiscalDocument(req: Request, res: Response) {
  const custom = getCustomRequest(req).customData;
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return fail(res, 422, "fiscal_document_invalid", "Documento fiscal inválido.");
  const invoice = await prisma.notaFiscal.findFirst({ where: { id: id.data, contaId: custom.contaId } });
  if (!invoice) return fail(res, 404, "fiscal_document_not_found", "Documento fiscal não encontrado.");
  if (!["NFE", "NFCE"].includes(invoice.tipo) || !["PENDENTE", "FALHA_REPROCESSAVEL"].includes(invoice.status)) return fail(res, 409, "fiscal_retry_not_allowed", "Somente NF-e ou NFC-e pendente ou com falha reprocessável pode ser reenviada.");
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
  // A Geranet identifica a nota pela chave e protocolo da SEFAZ; ela não
  // devolve um id interno de documento como o provedor legado.
  if (invoice.status !== "AUTORIZADA" || (!['GERANET_NFE', 'GERANET_NFSE'].includes(invoice.provedor || "") && !invoice.provedorId)) return fail(res, 409, "fiscal_cancel_not_allowed", "Somente documento autorizado pode ser cancelado.");
  const idempotencyKey = String(req.headers["idempotency-key"] || randomUUID());
  const duplicate = invoice.Eventos.find((event) => event.idempotencyKey === idempotencyKey);
  if (duplicate) return res.status(202).json({ data: { eventoId: duplicate.id, status: duplicate.status }, requestId: randomUUID() });
  const event = await prisma.notaFiscalEvento.create({ data: { notaFiscalId: invoice.id, tipo: "CANCELAMENTO", status: "PROCESSANDO", motivo: body.data.motivo, idempotencyKey } });
  try {
    if (invoice.provedor === "GERANET_NFE") {
      const issuer = invoice.emitenteSnapshotJson as any;
      const address = issuer?.endereco || {};
      const credentials = await getGeranetCredentials(invoice);
      const response = await cancelGeranetNfe({ acao: "cancelar", modeloDocumento: "nfe", chave: invoice.chaveAcesso, protocolo: invoice.protocolo, justificativa: body.data.motivo, certificadoDigital: credentials.hex, senhaCertificadoDigital: credentials.password, ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", modelo: invoice.modelo, ufEmitente: address.uf });
      if (response.situacao !== "sucesso") throw Object.assign(new Error(response.mensagem || "Cancelamento rejeitado pela Geranet."), { response: { data: response } });
      await prisma.$transaction([
        prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: body.data.motivo, erroMensagem: null } }),
        prisma.notaFiscalEvento.update({ where: { id: event.id }, data: { status: "CONCLUIDO", processadoEm: new Date(), respostaJson: { ...response, xml: undefined, pdf: undefined } as any } }),
      ]);
      return res.status(200).json({ data: { eventoId: event.id, status: "CONCLUIDO" }, requestId: randomUUID() });
    }
    if (invoice.provedor === "GERANET_NFSE") {
      if (!invoice.xmlPath) throw new Error("O XML autorizado é necessário para cancelar esta NFS-e.");
      const prestador = invoice.emitenteSnapshotJson as any;
      const credentials = await getGeranetCredentials(invoice);
      const response = await cancelGeranetNfse({
        acao: "cancelar", modeloDocumento: "nfse", certificadoDigital: credentials.hex, senhaCertificadoDigital: credentials.password,
        ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", padraoNacional: "sim", xml: (await readFiscalArtifact(invoice.xmlPath)).toString("hex"),
        codigoCancelamento: "2", motivoCancelamento: body.data.motivo, prestador,
      });
      if (response.situacao !== "sucesso") throw Object.assign(new Error(response.mensagem || "Cancelamento rejeitado pela Geranet."), { response: { data: response } });
      await prisma.$transaction([
        prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: body.data.motivo, erroMensagem: null } }),
        prisma.notaFiscalEvento.update({ where: { id: event.id }, data: { status: "CONCLUIDO", processadoEm: new Date(), respostaJson: { ...response, xml: undefined, pdf: undefined } as any } }),
      ]);
      return res.status(200).json({ data: { eventoId: event.id, status: "CONCLUIDO" }, requestId: randomUUID() });
    }
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
  if (!invoice || (!['GERANET_NFE', 'GERANET_NFSE'].includes(invoice.provedor || "") && !invoice.provedorId)) return fail(res, 409, "fiscal_file_unavailable", "O arquivo ainda não está disponível.");
  try {
    if (invoice.provedor === "GERANET_NFE" || invoice.provedor === "GERANET_NFSE") {
      const reference = format.data === "xml" ? invoice.xmlPath : invoice.pdfPath;
      if (!reference) return fail(res, 409, "fiscal_file_unavailable", "O arquivo ainda não está disponível.");
      const binary = await readFiscalArtifact(reference);
      res.setHeader("Content-Disposition", `attachment; filename=${invoice.tipo}-${invoice.serie || 1}-${invoice.numero || invoice.id}.${format.data}`);
      res.type(format.data === "xml" ? "application/xml" : "application/pdf");
      return res.send(binary);
    }
    const binary = await downloadPlugNotas(invoice.tipo as "NFE" | "NFCE" | "NFSE", invoice.provedorId!, format.data);
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
