import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { extractPlugNotasResult, fiscalStatusFromProvider } from "./fiscalProviderPolicy";
import { getPlugNotasByIntegration, getPlugNotasSummary, sendPlugNotas } from "./plugNotas";

export type FiscalSaleType = "NFE" | "NFCE";

function fiscalError(message: string, code = "fiscal_preflight_failed") {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function digits(value: unknown) { return String(value || "").replace(/\D/g, ""); }

async function reserveNumber(tx: Prisma.TransactionClient, contaId: number, type: FiscalSaleType) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const config = await tx.notaFiscalConfiguracao.findUnique({ where: { contaId } });
    if (!config) throw fiscalError("Conclua a configuração fiscal antes de selecionar uma nota.");
    const enabled = type === "NFE" ? config.nfeHabilitado : config.nfceHabilitado;
    if (!enabled) throw fiscalError(`${type === "NFE" ? "NF-e" : "NFC-e"} está desativada nas configurações fiscais.`, "fiscal_document_disabled");
    const next = type === "NFE" ? config.proximoNumeroNfe : config.proximoNumeroNfce;
    const serie = type === "NFE" ? config.serieNfe : config.serieNfce;
    const missing = [config.razaoSocial, config.documento, config.inscricaoEstadual, config.codigoMunicipioIbge, config.uf, config.cep, config.logradouro, config.numero, config.bairro, config.certificadoReferencia, config.certificadoSenhaCifrada]
      .some((value) => !value);
    if (missing) throw fiscalError("Conclua os dados do emissor, endereço, inscrição estadual e certificado A1 antes de emitir.");
    if (type === "NFCE" && (!config.nfceCscId || !config.nfceCscTokenCifrado)) throw fiscalError("Configure CSC ID e token da NFC-e antes de emitir.");
    const reservation = await tx.notaFiscalConfiguracao.updateMany({
      where: type === "NFE" ? { contaId, proximoNumeroNfe: next } : { contaId, proximoNumeroNfce: next },
      data: type === "NFE" ? { proximoNumeroNfe: { increment: 1 } } : { proximoNumeroNfce: { increment: 1 } },
    });
    if (reservation.count === 1) return { config, serie, numero: next };
  }
  throw fiscalError("Não foi possível reservar a numeração fiscal. Tente novamente.", "fiscal_number_reservation_conflict");
}

export async function createFiscalIntentForSale(tx: Prisma.TransactionClient, input: { contaId: number; vendaId: number; tipo: FiscalSaleType; idempotencyKey?: string }) {
  const existing = await tx.notaFiscal.findFirst({
    where: { contaId: input.contaId, vendaId: input.vendaId, status: { notIn: ["REJEITADA", "CANCELADA"] } },
  });
  if (existing) {
    if (existing.tipo !== input.tipo) {
      throw fiscalError("Esta venda já possui um documento fiscal ativo. Cancele ou conclua o documento atual antes de escolher outro tipo.", "fiscal_document_already_exists");
    }
    return existing;
  }

  const sale = await tx.vendas.findUniqueOrThrow({
    where: { id: input.vendaId, contaId: input.contaId },
    include: { cliente: true, ItensVendas: { include: { produto: true, servico: true } }, ComboSaidas: { include: { componentes: { include: { Produto: true, Servico: true } } } } },
  });
  if (sale.ItensVendas.some((item) => item.servicoId) || sale.ComboSaidas.some((combo) => combo.componentes.some((item) => item.servicoId))) {
    throw fiscalError("Vendas com serviços devem usar NFS-e; selecione Não emitir para concluir esta venda.", "fiscal_service_item_not_supported");
  }
  if (input.tipo === "NFE" && !digits(sale.cliente?.documento)) {
    throw fiscalError("NF-e exige um cliente com CPF ou CNPJ informado.", "fiscal_recipient_required");
  }
  const { config, serie, numero } = await reserveNumber(tx, input.contaId, input.tipo);
  const lines = [
    ...sale.ItensVendas.map((item) => ({ produto: item.produto, descricao: item.itemName || item.produto?.nome || "Produto", quantidade: Number(item.quantidade), valor: Number(item.valor) })),
    ...sale.ComboSaidas.flatMap((combo) => combo.componentes.map((item) => ({ produto: item.Produto, descricao: item.nomeSnapshot, quantidade: Number(item.quantidadeTotal), valor: Number(item.valorUnitarioRateado) }))),
  ];
  if (!lines.length) throw fiscalError("A venda não possui itens fiscais para emissão.");
  const invalid = lines.find(({ produto }) => !produto || !digits(produto.ncm) || !digits(produto.cfop) || produto.origem == null);
  if (invalid) throw fiscalError("Há produto sem NCM, CFOP ou origem fiscal. Corrija o cadastro antes de emitir.");
  const idempotencyKey = input.idempotencyKey || `venda:${sale.id}:${input.tipo}:${randomUUID()}`;
  return tx.notaFiscal.create({
    data: {
      contaId: input.contaId, vendaId: sale.id, tipo: input.tipo, modelo: input.tipo === "NFE" ? "55" : "65", serie, numero: String(numero),
      clienteId: sale.clienteId || null, valorTotal: sale.valor, status: "PENDENTE", ambiente: config.ambiente, provedor: "TECNOSPEED_PLUGNOTAS", idempotencyKey,
      emitenteSnapshotJson: { documento: digits(config.documento), razaoSocial: config.razaoSocial, ie: config.inscricaoEstadual, endereco: { codigoMunicipioIbge: config.codigoMunicipioIbge, uf: config.uf, cep: config.cep, logradouro: config.logradouro, numero: config.numero, bairro: config.bairro } },
      destinatarioSnapshotJson: sale.cliente ? { documento: digits(sale.cliente.documento), nome: sale.cliente.nome, email: sale.cliente.email, endereco: sale.cliente.endereco, cep: sale.cliente.cep, cidade: sale.cliente.cidade, uf: sale.cliente.estado } : null,
      Itens: { create: lines.map(({ produto, descricao, quantidade, valor }) => ({ produtoId: produto!.id, descricao, quantidade, valorUnitario: valor, valorTotal: Number((quantidade * valor).toFixed(2)), unidade: produto!.unidade || "UN", ncm: digits(produto!.ncm), cest: digits(produto!.cest) || null, cfop: digits(produto!.cfop), origem: produto!.origem, tributacaoJson: { aliquotaIcms: produto!.aliquotaIcms, aliquotaPis: produto!.aliquotaPis, aliquotaCofins: produto!.aliquotaCofins } })) },
    },
  });
}

function toPlugNotasPayload(invoice: any) {
  const issuer = invoice.emitenteSnapshotJson || {};
  const recipient = invoice.destinatarioSnapshotJson || {};
  return {
    idIntegracao: invoice.idIntegracao || `gestaofacil-nota-${invoice.id}`,
    emitente: issuer,
    destinatario: recipient,
    serie: invoice.serie,
    numero: Number(invoice.numero),
    finalidade: 1,
    consumidorFinal: invoice.tipo === "NFCE",
    itens: invoice.Itens.map((item: any) => ({ codigo: String(item.produtoId), descricao: item.descricao, ncm: item.ncm, cest: item.cest || undefined, cfop: item.cfop, unidade: item.unidade || "UN", quantidade: Number(item.quantidade), valorUnitario: Number(item.valorUnitario), origem: item.origem, tributos: item.tributacaoJson || {} })),
  };
}

export async function processFiscalEmission(notaFiscalId: number) {
  const invoice = await prisma.notaFiscal.findUnique({ where: { id: notaFiscalId }, include: { Itens: true } });
  if (!invoice || !["PENDENTE", "FALHA_REPROCESSAVEL"].includes(invoice.status) || !["NFE", "NFCE"].includes(invoice.tipo)) return;
  const idIntegracao = invoice.idIntegracao || `gestaofacil-nota-${invoice.id}`;
  await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "EMITINDO", idIntegracao } });
  try {
    const emitente = invoice.emitenteSnapshotJson as any;
    const prior = await getPlugNotasByIntegration(invoice.tipo as FiscalSaleType, digits(emitente?.documento), idIntegracao);
    if (prior) {
      const result = extractPlugNotasResult(prior);
      await updateFiscalDocumentFromProvider(invoice.id, result, prior);
      return;
    }
    const response = await sendPlugNotas(invoice.tipo as FiscalSaleType, toPlugNotasPayload({ ...invoice, idIntegracao }));
    const result = extractPlugNotasResult(response);
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "EM_PROCESSAMENTO", provedorId: String(result?.id || result?.idNota || "") || null, respostaJson: response as any, erroMensagem: null } });
  } catch (error: any) {
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "FALHA_REPROCESSAVEL", erroMensagem: error?.response?.data?.message || error?.message || "Falha ao enviar ao provedor." } });
    throw error;
  }
}

export async function updateFiscalDocumentFromProvider(invoiceId: number, result: any, raw: unknown = result) {
  const status = fiscalStatusFromProvider(result?.status || result?.situacao);
  await prisma.notaFiscal.update({
    where: { id: invoiceId },
    data: {
      status,
      provedorId: String(result?.id || result?.idNota || "") || undefined,
      chaveAcesso: result?.chave || result?.chaveAcesso || undefined,
      protocolo: result?.protocolo || undefined,
      emitidaEm: status === "AUTORIZADA" ? new Date() : undefined,
      canceladaEm: status === "CANCELADA" ? new Date() : undefined,
      respostaJson: raw as any,
      erroMensagem: status === "REJEITADA" ? String(result?.mensagem || result?.message || "Documento rejeitado pelo autorizador.") : null,
    },
  });
}

/** Reconciliação faz o banco voltar a refletir o provedor mesmo se um webhook se perder. */
export async function reconcilePendingFiscalDocuments() {
  const invoices = await prisma.notaFiscal.findMany({
    where: { tipo: { in: ["NFE", "NFCE"] }, status: { in: ["EMITINDO", "EM_PROCESSAMENTO"] }, provedorId: { not: null } },
    select: { id: true, tipo: true, provedorId: true },
    take: 100,
    orderBy: { atualizadaEm: "asc" },
  });
  for (const invoice of invoices) {
    const response = await getPlugNotasSummary(invoice.tipo as FiscalSaleType, invoice.provedorId!);
    await updateFiscalDocumentFromProvider(invoice.id, extractPlugNotasResult(response), response);
  }
  return invoices.length;
}
