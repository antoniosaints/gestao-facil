import { randomUUID } from "node:crypto";
import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { consultarMunicipiosIbge } from "./municipios";
import { decryptCertificateBuffer, decryptFiscalSecret } from "./certificateCrypto";
import { storeFiscalArtifact } from "./fiscalArtifactStorage";
import { emitGeranetNfe, listGeranetLogs, type GeranetResponse } from "./geranet";
import { extractPlugNotasResult, fiscalStatusFromProvider } from "./fiscalProviderPolicy";
import { getPlugNotasByIntegration, getPlugNotasSummary, sendPlugNotas } from "./plugNotas";
import { readStoredFileBuffer } from "../uploads/fileStorageService";

export type FiscalSaleType = "NFE" | "NFCE";
const digits = (value: unknown) => String(value || "").replace(/\D/g, "");
const decimal = (value: unknown, places = 2) => Number(value || 0).toFixed(places);
type FiscalProductIssue = { produtoId: number | null; descricao: string; campos: string[] };
type FiscalLine = { produto: any; descricao: string; campos?: string[] };
function fiscalError(message: string, code = "fiscal_preflight_failed", details?: unknown) { return Object.assign(new Error(message), { code, status: 422, details }); }
function cleanResponse(response: GeranetResponse) { const { xml: _xml, pdf: _pdf, ...safe } = response; return safe; }

function collectFiscalProductIssues(lines: FiscalLine[], regimeTributario: number) {
  const isSimple = regimeTributario === 1 || regimeTributario === 4;
  const issues: FiscalProductIssue[] = [];
  for (const { produto, descricao, campos: customCampos } of lines) {
    const campos: string[] = [...(customCampos || [])];
    if (campos.length) { issues.push({ produtoId: produto?.id ?? null, descricao, campos }); continue; }
    if (!produto) campos.push("Produto indisponível");
    else {
      if (!digits(produto.ncm)) campos.push("NCM");
      if (!digits(produto.cfop)) campos.push("CFOP");
      if (produto.origem == null) campos.push("Origem da mercadoria");
      if (isSimple ? !produto.icmsCsosn : !produto.icmsCst) campos.push(isSimple ? "CSOSN" : "CST de ICMS");
      if (produto.icmsAliquotaSt != null && (produto.icmsModBcSt !== "4" || produto.icmsMva == null)) campos.push("ICMS-ST: informe modalidade 4 e MVA");
    }
    if (campos.length) issues.push({ produtoId: produto?.id ?? null, descricao, campos });
  }
  return issues;
}

function throwFiscalProductIssues(issues: FiscalProductIssue[]) {
  if (issues.length) throw fiscalError("Há produtos com dados fiscais pendentes. Corrija o cadastro ou conclua a venda sem emitir agora.", "fiscal_product_data_incomplete", { itens: issues });
}

export async function validateFiscalSalePreflight(contaId: number, items: Array<{ id: number; tipo: string; nome?: string }>) {
  const config = await prisma.notaFiscalConfiguracao.findUnique({ where: { contaId }, select: { regimeTributario: true } });
  if (!config || config.regimeTributario < 1) throw fiscalError("Conclua a configuração do regime tributário antes de emitir pela venda.", "fiscal_config_incomplete");
  const productIds = items.filter((item) => item.tipo === "PRODUTO").map((item) => item.id);
  const comboIds = items.filter((item) => item.tipo === "COMBO").map((item) => item.id);
  const [products, combos] = await Promise.all([
    productIds.length ? prisma.produto.findMany({ where: { contaId, id: { in: productIds } } }) : Promise.resolve([]),
    comboIds.length ? prisma.combo.findMany({ where: { contaId, id: { in: comboIds }, ativo: true }, include: { componentes: { include: { Produto: true, Servico: true } } } }) : Promise.resolve([]),
  ]);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const combosById = new Map(combos.map((combo) => [combo.id, combo]));
  const lines: FiscalLine[] = [];
  for (const item of items) {
    if (item.tipo === "PRODUTO") lines.push({ produto: productsById.get(item.id) || null, descricao: item.nome || productsById.get(item.id)?.nome || `Produto #${item.id}` });
    if (item.tipo === "SERVICO") lines.push({ produto: null, descricao: item.nome || `Serviço #${item.id}`, campos: ["Serviço: emita NFS-e em vez de NF-e/NFC-e"] });
    if (item.tipo === "COMBO") {
      const combo = combosById.get(item.id);
      if (!combo) lines.push({ produto: null, descricao: item.nome || `Combo #${item.id}` });
      else for (const component of combo.componentes) {
        if (component.tipo === "SERVICO") lines.push({ produto: null, descricao: `${combo.nome} › ${component.Servico?.nome || "Serviço"}`, campos: ["Serviço: emita NFS-e em vez de NF-e/NFC-e"] });
        else lines.push({ produto: component.Produto, descricao: `${combo.nome} › ${component.Produto ? `${component.Produto.nome}${component.Produto.nomeVariante ? ` / ${component.Produto.nomeVariante}` : ""}` : "Produto"}` });
      }
    }
  }
  throwFiscalProductIssues(collectFiscalProductIssues(lines, config.regimeTributario));
}

async function reserveNumber(tx: Prisma.TransactionClient, contaId: number, type: FiscalSaleType) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const config = await tx.notaFiscalConfiguracao.findUnique({ where: { contaId } });
    if (!config) throw fiscalError("Conclua a configuração fiscal antes de selecionar uma nota.");
    if (!(type === "NFE" ? config.nfeHabilitado : config.nfceHabilitado)) throw fiscalError(`${type === "NFE" ? "NF-e" : "NFC-e"} está desativada nas configurações fiscais.`, "fiscal_document_disabled");
    const missing = [config.razaoSocial, config.documento, config.inscricaoEstadual, config.codigoMunicipioIbge, config.municipioNome, config.uf, config.cep, config.logradouro, config.numero, config.bairro, config.certificadoReferencia, config.certificadoSenhaCifrada].some((value) => !value);
    if (missing || config.regimeTributario < 1) throw fiscalError("Conclua o emitente, endereço, município, regime tributário e certificado A1 antes de emitir.");
    if (type === "NFCE" && (!config.nfceCscId || !config.nfceCscTokenCifrado)) throw fiscalError("Configure CSC ID e token da NFC-e antes de emitir.");
    const number = type === "NFE" ? config.proximoNumeroNfe : config.proximoNumeroNfce;
    const result = await tx.notaFiscalConfiguracao.updateMany({ where: type === "NFE" ? { contaId, proximoNumeroNfe: number } : { contaId, proximoNumeroNfce: number }, data: type === "NFE" ? { proximoNumeroNfe: { increment: 1 } } : { proximoNumeroNfce: { increment: 1 } } });
    if (result.count === 1) return { config, serie: type === "NFE" ? config.serieNfe : config.serieNfce, numero: number };
  }
  throw fiscalError("Não foi possível reservar a numeração fiscal. Tente novamente.", "fiscal_number_reservation_conflict");
}

async function clientMunicipality(client: any) {
  if (!client?.cidade || !client?.estado) throw fiscalError("NF-e exige cidade e UF no cadastro do destinatário.", "fiscal_recipient_address_required");
  const matches = await consultarMunicipiosIbge(client.estado, client.cidade);
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const found = matches.find((item) => normalize(item.nome) === normalize(client.cidade));
  if (!found) throw fiscalError("Não foi possível identificar o código IBGE do município do destinatário.", "fiscal_recipient_municipality_invalid");
  return found.codigoIbge;
}

export async function createFiscalIntentForSale(tx: Prisma.TransactionClient, input: { contaId: number; vendaId: number; tipo: FiscalSaleType; idempotencyKey?: string }) {
  const existing = await tx.notaFiscal.findFirst({ where: { contaId: input.contaId, vendaId: input.vendaId, status: { notIn: ["REJEITADA", "CANCELADA"] } } });
  if (existing) { if (existing.tipo !== input.tipo) throw fiscalError("Esta venda já possui documento fiscal ativo.", "fiscal_document_already_exists"); return existing; }
  const sale = await tx.vendas.findUniqueOrThrow({ where: { id: input.vendaId, contaId: input.contaId }, include: { cliente: true, PagamentoVendas: true, ItensVendas: { include: { produto: true, servico: true } }, ComboSaidas: { include: { componentes: { include: { Produto: true, Servico: true } } } } } });
  if (sale.ItensVendas.some((item) => item.servicoId) || sale.ComboSaidas.some((combo) => combo.componentes.some((item) => item.servicoId))) throw fiscalError("Vendas com serviços devem usar NFS-e.", "fiscal_service_item_not_supported");
  if (input.tipo === "NFE" && !digits(sale.cliente?.documento)) throw fiscalError("NF-e exige um cliente com CPF ou CNPJ informado.", "fiscal_recipient_required");
  const municipality = sale.cliente ? await clientMunicipality(sale.cliente) : null;
  const { config, serie, numero } = await reserveNumber(tx, input.contaId, input.tipo);
  const lines = [...sale.ItensVendas.map((item) => ({ produto: item.produto, descricao: item.itemName || item.produto?.nome || "Produto", quantidade: Number(item.quantidade), valor: Number(item.valor) })), ...sale.ComboSaidas.flatMap((combo) => combo.componentes.map((item) => ({ produto: item.Produto, descricao: item.nomeSnapshot, quantidade: Number(item.quantidadeTotal), valor: Number(item.valorUnitarioRateado) })) )];
  if (!lines.length) throw fiscalError("A venda não possui itens fiscais para emissão.");
  throwFiscalProductIssues(collectFiscalProductIssues(lines, config.regimeTributario));
  return tx.notaFiscal.create({ data: {
    contaId: input.contaId, vendaId: sale.id, tipo: input.tipo, modelo: input.tipo === "NFE" ? "55" : "65", serie, numero: String(numero), clienteId: sale.clienteId || null, valorTotal: sale.valor, status: "PENDENTE", ambiente: config.ambiente, provedor: "GERANET_NFE", idempotencyKey: input.idempotencyKey || `venda:${sale.id}:${input.tipo}:${randomUUID()}`,
    emitenteSnapshotJson: { documento: digits(config.documento), razaoSocial: config.razaoSocial, nomeFantasia: config.nomeFantasia, ie: config.inscricaoEstadual, regimeTributario: config.regimeTributario, municipio: config.municipioNome, endereco: { codigoMunicipioIbge: config.codigoMunicipioIbge, uf: config.uf, cep: config.cep, logradouro: config.logradouro, numero: config.numero, bairro: config.bairro, complemento: config.complemento }, email: config.email, telefone: config.telefone, naturezaOperacao: config.nfeNaturezaOperacao, tipoAtividade: config.nfeTipoAtividade, indicadorPresenca: config.nfeIndicadorPresenca, indicativoIntermediador: config.nfeIndicativoIntermediador, frete: config.nfeFrete, responsavelTecnico: { cnpj: config.responsavelTecnicoCnpj, contato: config.responsavelTecnicoContato, email: config.responsavelTecnicoEmail, fone: config.responsavelTecnicoTelefone, idCSRT: config.responsavelTecnicoCsrtId } },
    destinatarioSnapshotJson: sale.cliente ? { documento: digits(sale.cliente.documento), nome: sale.cliente.nome, ie: sale.cliente.ie, email: sale.cliente.email, telefone: sale.cliente.telefone, endereco: sale.cliente.endereco, numero: sale.cliente.numero, bairro: sale.cliente.bairro, cep: sale.cliente.cep, cidade: sale.cliente.cidade, codigoMunicipioIbge: municipality, uf: sale.cliente.estado } : Prisma.JsonNull,
    tributosSnapshotJson: { pagamento: sale.PagamentoVendas ? { metodo: sale.PagamentoVendas.metodo, detalhes: sale.PagamentoVendas.detalhes, valor: Number(sale.PagamentoVendas.valor), data: sale.PagamentoVendas.data } : null },
    Itens: { create: lines.map(({ produto, descricao, quantidade, valor }) => ({ produtoId: produto!.id, descricao, quantidade, valorUnitario: valor, valorTotal: Number((quantidade * valor).toFixed(2)), unidade: produto!.unidade || "UN", ncm: digits(produto!.ncm), cest: digits(produto!.cest) || null, cfop: digits(produto!.cfop), origem: produto!.origem, tributacaoJson: { ean: produto!.ean, tipoItem: produto!.tipoItem || "00", icmsCsosn: produto!.icmsCsosn, icmsCst: produto!.icmsCst, icmsModBcSt: produto!.icmsModBcSt, icmsMva: Number(produto!.icmsMva || 0), icmsReducaoBcSt: Number(produto!.icmsReducaoBcSt || 0), icmsAliquotaSt: produto!.icmsAliquotaSt == null ? null : Number(produto!.icmsAliquotaSt), fcpAliquota: Number(produto!.fcpAliquota || 0), fcpStAliquota: Number(produto!.fcpStAliquota || 0), icmsDesoneradoValor: Number(produto!.icmsDesoneradoValor || 0), icmsDesoneradoMotivo: produto!.icmsDesoneradoMotivo, icmsCreditoAliquota: Number(produto!.icmsCreditoAliquota || 0), ipiCst: produto!.ipiCst, ipiCodigoEnquadramento: produto!.ipiCodigoEnquadramento, difalAliquotaInterna: Number(produto!.difalAliquotaInterna || 0), difalFcpAliquota: Number(produto!.difalFcpAliquota || 0), pisCst: produto!.pisCst || "08", cofinsCst: produto!.cofinsCst || "08", aliquotaIcms: Number(produto!.aliquotaIcms || 0), aliquotaIpi: Number(produto!.aliquotaIpi || 0), aliquotaPis: Number(produto!.aliquotaPis || 0), aliquotaCofins: Number(produto!.aliquotaCofins || 0) } })) },
  } });
}

function paymentCode(method: string) { return ({ DINHEIRO: "01", CHEQUE: "02", CREDITO: "03", DEBITO: "04", CARTAO: "99", PIX: "17", BOLETO: "15", TRANSFERENCIA: "18", CREDIARIO: "14", OUTRO: "99", GATEWAY: "99" } as Record<string, string>)[method] || "99"; }
export async function getGeranetCredentials(invoice: any) {
  const config = await prisma.notaFiscalConfiguracao.findUniqueOrThrow({ where: { contaId: invoice.contaId } });
  if (!config.certificadoReferencia || !config.certificadoSenhaCifrada) throw fiscalError("O certificado A1 não está configurado.");
  return { hex: decryptCertificateBuffer(await readStoredFileBuffer(config.certificadoReferencia)).toString("hex"), password: decryptFiscalSecret(config.certificadoSenhaCifrada), csc: invoice.tipo === "NFCE" && config.nfceCscId && config.nfceCscTokenCifrado ? { id: config.nfceCscId, token: decryptFiscalSecret(config.nfceCscTokenCifrado) } : null, csrt: config.responsavelTecnicoCsrtCifrado ? decryptFiscalSecret(config.responsavelTecnicoCsrtCifrado) : null };
}

function geranetPayload(invoice: any, auth: Awaited<ReturnType<typeof getGeranetCredentials>>) {
  const issuer = invoice.emitenteSnapshotJson || {}, address = issuer.endereco || {}, recipient = invoice.destinatarioSnapshotJson || {}, payment = invoice.tributosSnapshotJson?.pagamento;
  const payments = Array.isArray(payment?.detalhes) && payment.detalhes.length ? payment.detalhes : [{ metodo: payment?.metodo || "OUTRO", valor: payment?.valor || invoice.valorTotal }];
  const isSimple = String(issuer.regimeTributario) === "1" || String(issuer.regimeTributario) === "4";
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const technical = issuer.responsavelTecnico || {};
  const paymentDetails = payments.map((item: any) => ({ tipo: paymentCode(item.metodo), valor: Number(item.valor), indicadorPagamento: ["CREDIARIO", "BOLETO"].includes(item.metodo) ? "1" : "0" }));
  const isInstallment = paymentDetails.some((item) => item.indicadorPagamento === "1");
  const dueDate = payment?.data ? new Date(payment.data).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const totalInstallment = paymentDetails.filter((item) => item.indicadorPagamento === "1").reduce((sum, item) => sum + item.valor, 0);
  return { acao: "emitir", modeloDocumento: "nfe", nomeSistema: "Gestão Fácil", certificadoDigital: auth.hex, senhaCertificadoDigital: auth.password, ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", modelo: invoice.modelo, ufEmitente: address.uf, ...(invoice.tipo === "NFCE" ? { idCsc: auth.csc?.id, csc: auth.csc?.token } : {}), nfe: {
    empresa: { cnpj: issuer.documento, inscricaoEstadual: issuer.ie, razaoSocial: issuer.razaoSocial, nomeFantasia: issuer.nomeFantasia || "", telefone: issuer.telefone || "", email: issuer.email || "", logradouro: address.logradouro, numero: address.numero, complemento: address.complemento || "", bairro: address.bairro, municipio: issuer.municipio, codigoMunicipio: address.codigoMunicipioIbge, uf: address.uf, cep: digits(address.cep), codigoRegimeTributario: String(issuer.regimeTributario), tipoAtividade: issuer.tipoAtividade || "1", serie: String(invoice.serie), ibptAutomatico: "sim" },
    cliente: invoice.tipo === "NFCE" && !recipient.documento ? { consumidorFinal: "1", indicadorIEdestinatario: "9" } : { cnpj: digits(recipient.documento).length === 14 ? digits(recipient.documento) : "", cpf: digits(recipient.documento).length === 11 ? digits(recipient.documento) : "", inscricaoEstadual: recipient.ie || "", razaoSocial: recipient.nome, consumidorFinal: "1", indicadorIEdestinatario: recipient.ie ? "1" : "9", telefone: recipient.telefone || "", email: recipient.email || "", logradouro: recipient.endereco || "", numero: recipient.numero || "", bairro: recipient.bairro || "", municipio: recipient.cidade || "", codigoMunicipio: recipient.codigoMunicipioIbge || "", codigoPais: "1058", nomePais: "Brasil", uf: recipient.uf || "", cep: digits(recipient.cep) },
    indicadorPresenca: issuer.indicadorPresenca || "1", indicativoIntermediador: issuer.indicativoIntermediador || "0", numeroNotaEmitir: String(invoice.numero), codigoNumerico: String(Math.floor(Math.random() * 100000000)).padStart(8, "0"), dataSaida: now, dataEmissao: now, modelo: invoice.modelo, ambiente: invoice.ambiente === "PRODUCAO" ? "1" : "2", tipo: "1", frete: issuer.frete || "9", finalidade: "1", naturezaOperacao: issuer.naturezaOperacao || "Venda de mercadoria", numeroVenda: String(invoice.vendaId || ""),
    pagamento: { troco: 0, detalhamento: paymentDetails },
    ...(isInstallment ? { fatura: { numero: String(invoice.numero), valor: decimal(totalInstallment), desconto: "0.00", valorLiquido: decimal(totalInstallment), duplicatas: [{ numero: "001", dataVencimento: dueDate, valor: decimal(totalInstallment) }] } } : {}),
    ...(technical.cnpj && technical.contato && technical.email && technical.fone ? { responsavelTecnico: { cnpj: digits(technical.cnpj), contato: technical.contato, email: technical.email, fone: digits(technical.fone), ...(technical.idCSRT && auth.csrt ? { idCSRT: technical.idCSRT, CSRT: auth.csrt } : {}) } } : {}),
    itens: invoice.Itens.map((item: any) => { const tax = item.tributacaoJson || {}; const total = Number(item.valorTotal); const stBase = total * (1 + Number(tax.icmsMva || 0) / 100) * (1 - Number(tax.icmsReducaoBcSt || 0) / 100); const st = tax.icmsAliquotaSt == null ? {} : { icmsModBcSt: tax.icmsModBcSt || "4", icmsMva: decimal(tax.icmsMva), icmsRedBcSt: decimal(tax.icmsReducaoBcSt), icmsBcSt: decimal(stBase), icmsStAliquota: decimal(tax.icmsAliquotaSt), icmsStValor: decimal(stBase * Number(tax.icmsAliquotaSt) / 100) }; return { desconto: "0.00", frete: "0.00", seguro: "0.00", outro: "0.00", quantidade: decimal(item.quantidade, 4), valorUnitario: decimal(item.valorUnitario, 4), valorTotal: decimal(item.valorTotal), ncmProduto: item.ncm, cest: item.cest || "", tipoItem: tax.tipoItem || "00", eanProduto: tax.ean || "SEM GTIN", codigoProduto: String(item.produtoId), nomeProduto: item.descricao, cfop: item.cfop, unidadeMedidaProduto: item.unidade || "UN", origemProduto: String(item.origem), ...(isSimple ? { icmsCsosn: tax.icmsCsosn } : { icmsCst: tax.icmsCst, icmsAliquota: decimal(tax.aliquotaIcms) }), ...st, pisCst: tax.pisCst || "08", pisAliquota: decimal(tax.aliquotaPis), cofinsCst: tax.cofinsCst || "08", cofinsAliquota: decimal(tax.aliquotaCofins) }; }),
  } };
}

async function persistArtifacts(invoice: any, response: GeranetResponse) {
  const data: Record<string, string> = {};
  if (response.xml) data.xmlPath = await storeFiscalArtifact({ contaId: invoice.contaId, notaFiscalId: invoice.id, format: "xml", bytes: Buffer.from(response.xml, "hex"), previousReference: invoice.xmlPath });
  if (response.pdf) data.pdfPath = await storeFiscalArtifact({ contaId: invoice.contaId, notaFiscalId: invoice.id, format: "pdf", bytes: Buffer.from(response.pdf, "hex"), previousReference: invoice.pdfPath });
  return data;
}

async function processGeranet(invoice: any) {
  try {
    const response = await emitGeranetNfe(geranetPayload(invoice, await getGeranetCredentials(invoice)));
    if (response.situacao !== "sucesso" || String(response.cstat || "100") !== "100") { await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "REJEITADA", respostaJson: cleanResponse(response) as any, erroMensagem: response.mensagem || "Documento rejeitado." } }); return; }
    const artifacts = await persistArtifacts(invoice, response);
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "AUTORIZADA", chaveAcesso: response.chave || null, protocolo: response.protocolo || null, emitidaEm: new Date(), respostaJson: cleanResponse(response) as any, erroMensagem: null, ...artifacts } });
  } catch (error: any) {
    const response = error?.response?.data as GeranetResponse | undefined;
    await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: !response || String(response.cstat) === "204" ? "RESULTADO_INCERTO" : "REJEITADA", respostaJson: response ? cleanResponse(response) as any : undefined, erroMensagem: response?.mensagem || error?.message || "Falha ao enviar à Geranet." } });
  }
}

function plugPayload(invoice: any) { const issuer = invoice.emitenteSnapshotJson || {}, recipient = invoice.destinatarioSnapshotJson || {}; return { idIntegracao: invoice.idIntegracao || `gestaofacil-nota-${invoice.id}`, emitente: issuer, destinatario: recipient, serie: invoice.serie, numero: Number(invoice.numero), finalidade: 1, consumidorFinal: invoice.tipo === "NFCE", itens: invoice.Itens.map((item: any) => ({ codigo: String(item.produtoId), descricao: item.descricao, ncm: item.ncm, cest: item.cest || undefined, cfop: item.cfop, unidade: item.unidade || "UN", quantidade: Number(item.quantidade), valorUnitario: Number(item.valorUnitario), origem: item.origem, tributos: item.tributacaoJson || {} })) }; }

export async function processFiscalEmission(notaFiscalId: number) {
  const invoice = await prisma.notaFiscal.findUnique({ where: { id: notaFiscalId }, include: { Itens: true } });
  if (!invoice || !["PENDENTE", "FALHA_REPROCESSAVEL"].includes(invoice.status) || !["NFE", "NFCE"].includes(invoice.tipo)) return;
  await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "EMITINDO", idIntegracao: invoice.idIntegracao || `gestaofacil-nota-${invoice.id}` } });
  if (invoice.provedor === "GERANET_NFE") return processGeranet(invoice);
  try { const prior = await getPlugNotasByIntegration(invoice.tipo as FiscalSaleType, digits((invoice.emitenteSnapshotJson as any)?.documento), invoice.idIntegracao || `gestaofacil-nota-${invoice.id}`); if (prior) return updateFiscalDocumentFromProvider(invoice.id, extractPlugNotasResult(prior), prior); const response = await sendPlugNotas(invoice.tipo as FiscalSaleType, plugPayload(invoice)); const result = extractPlugNotasResult(response); await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "EM_PROCESSAMENTO", provedorId: String(result?.id || result?.idNota || "") || null, respostaJson: response as any, erroMensagem: null } }); } catch (error: any) { await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "FALHA_REPROCESSAVEL", erroMensagem: error?.response?.data?.message || error?.message || "Falha ao enviar ao provedor." } }); throw error; }
}

export async function updateFiscalDocumentFromProvider(invoiceId: number, result: any, raw: unknown = result) { const status = fiscalStatusFromProvider(result?.status || result?.situacao); await prisma.notaFiscal.update({ where: { id: invoiceId }, data: { status, provedorId: String(result?.id || result?.idNota || "") || undefined, chaveAcesso: result?.chave || result?.chaveAcesso || undefined, protocolo: result?.protocolo || undefined, emitidaEm: status === "AUTORIZADA" ? new Date() : undefined, canceladaEm: status === "CANCELADA" ? new Date() : undefined, respostaJson: raw as any, erroMensagem: status === "REJEITADA" ? String(result?.mensagem || result?.message || "Documento rejeitado pelo autorizador.") : null } }); }

async function reconcileGeranet() {
  const invoices = await prisma.notaFiscal.findMany({ where: { provedor: "GERANET_NFE", status: "RESULTADO_INCERTO" }, select: { id: true, numero: true, criadoEm: true, emitenteSnapshotJson: true }, take: 50 });
  for (const invoice of invoices) try { const logs = (await listGeranetLogs({ cnpj: digits((invoice.emitenteSnapshotJson as any)?.documento), dataDe: new Date(invoice.criadoEm.getTime() - 60_000).toISOString(), dataAte: new Date().toISOString() }))?.logs || []; const match = logs.find((log: any) => String(log?.endpoint || "").includes("nfe/emitir") && String(log?.resposta?.numero || log?.payload?.nfe?.numeroNotaEmitir || "") === String(invoice.numero)); if (match?.resposta?.situacao === "sucesso") await prisma.notaFiscal.update({ where: { id: invoice.id }, data: { status: "AUTORIZADA", chaveAcesso: match.resposta.chave || null, protocolo: match.resposta.protocolo || null, emitidaEm: new Date(), respostaJson: cleanResponse(match.resposta) as any, erroMensagem: "Recuperada pela auditoria Geranet; verifique os anexos do provedor." } }); } catch { /* não reenviar sem resultado confirmado */ }
}

export async function reconcilePendingFiscalDocuments() {
  const invoices = await prisma.notaFiscal.findMany({ where: { provedor: "TECNOSPEED_PLUGNOTAS", tipo: { in: ["NFE", "NFCE"] }, status: { in: ["EMITINDO", "EM_PROCESSAMENTO"] }, provedorId: { not: null } }, select: { id: true, tipo: true, provedorId: true }, take: 100, orderBy: { atualizadaEm: "asc" } });
  for (const invoice of invoices) { const response = await getPlugNotasSummary(invoice.tipo as FiscalSaleType, invoice.provedorId!); await updateFiscalDocumentFromProvider(invoice.id, extractPlugNotasResult(response), response); }
  await reconcileGeranet();
  return invoices.length;
}
