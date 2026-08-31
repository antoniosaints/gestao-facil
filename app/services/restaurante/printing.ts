import { createHash, randomUUID } from "node:crypto";
import { env } from "../../utils/dotenv";

export function hashPrintStationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function decidePrintFailure(input: {
  attempts: number;
  maxAttempts: number;
  stationId: number;
  fallbackStationId?: number | null;
}) {
  if (input.attempts < input.maxAttempts) return { action: "RETRY" as const };
  if (input.fallbackStationId && input.fallbackStationId !== input.stationId) {
    return { action: "FALLBACK" as const, stationId: input.fallbackStationId };
  }
  return { action: "FAIL" as const };
}

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function wrap(value: string, columns: number) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const originalWord of words) {
    let word = originalWord;
    while (word.length > columns) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, columns));
      word = word.slice(columns);
    }
    if (!word) continue;
    if (!current) current = word;
    else if (`${current} ${word}`.length <= columns) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatQuantity(value: string | number) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return clean(value);
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function formatMoney(value: unknown) {
  const amount = Number(value);
  return `R$ ${(Number.isFinite(amount) ? amount : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pair(left: string, right: string, columns: number) {
  const cleanLeft = clean(left);
  const cleanRight = clean(right);
  if (cleanLeft.length + cleanRight.length + 1 <= columns) {
    return [`${cleanLeft}${" ".repeat(columns - cleanLeft.length - cleanRight.length)}${cleanRight}`];
  }
  return [...wrap(cleanLeft, columns), cleanRight.padStart(columns).slice(-columns)];
}

function sectionTitle(title: string, columns: number) {
  return clean(title).toUpperCase().slice(0, columns);
}

function formatOrigin(origin: string, tableName?: string | null) {
  const labels: Record<string, string> = {
    BALCAO: "Balcao",
    MESA: "Mesa",
    QR_MESA: "Mesa",
    CARDAPIO: "Cardapio",
    RETIRADA: "Retirada no local",
    DELIVERY: "Delivery",
  };
  const label = labels[origin] || clean(origin).replace(/_/g, " ");
  return tableName ? `${label} - ${tableName}` : label;
}

function formatPaymentMethod(method?: string | null) {
  const labels: Record<string, string> = {
    DINHEIRO: "Dinheiro",
    CARTAO: "Cartao",
    CREDITO: "Cartao de credito",
    DEBITO: "Cartao de debito",
    PIX: "PIX",
    BOLETO: "Boleto",
    TRANSFERENCIA: "Transferencia",
    CHEQUE: "Cheque",
    NA_ENTREGA: "Pagamento na entrega",
    CHECKOUT_PRO: "Pagamento online",
    MESA: "Pagamento na mesa",
    MANUAL: "Pagamento manual",
  };
  const normalized = clean(method).trim().toUpperCase();
  return labels[normalized] || (normalized ? normalized.replace(/_/g, " ") : "Nao informado");
}

function formatPaymentStatus(status?: string | null) {
  const labels: Record<string, string> = {
    PENDENTE: "Pendente",
    PAGO: "Pago",
    NA_ENTREGA: "Cobrar do cliente",
    FALHOU: "Falhou",
    ESTORNADO: "Estornado",
    EM_REVISAO: "Em revisao",
  };
  return labels[clean(status).toUpperCase()] || clean(status || "Nao informado").replace(/_/g, " ");
}

function formatAddress(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const address = value as Record<string, unknown>;
  const text = (key: string) => typeof address[key] === "string" ? clean(address[key]).trim() : "";
  return [
    text("logradouro") ? `Endereco: ${text("logradouro")}` : "",
    text("numero") ? `Numero: ${text("numero")}` : "",
    text("complemento") ? `Complemento: ${text("complemento")}` : "",
    text("bairro") ? `Bairro: ${text("bairro")}` : "",
    text("cidade") ? `Cidade: ${text("cidade")}` : "",
    text("uf") ? `UF: ${text("uf")}` : "",
    text("cep") ? `CEP: ${text("cep")}` : "",
    text("referencia") ? `Referencia: ${text("referencia")}` : "",
  ].filter(Boolean);
}

function normalizeSystemUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(normalized);
    return `${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return normalized.replace(/^https?:\/\//i, "");
  }
}

type CompleteOrderReceiptInput = {
  uid: string;
  paper: string;
  pointName: string;
  businessName: string;
  businessAddress?: string | null;
  businessPhone?: string | null;
  systemUrl: string;
  orderCode: string;
  origin: string;
  tableName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  deliveryAddress?: unknown;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  changeFor?: unknown;
  subtotal: unknown;
  deliveryFee: unknown;
  discount: unknown;
  total: unknown;
  orderNote?: string | null;
  createdAt: Date;
  items: Array<{
    quantity: string | number;
    name: string;
    unitPrice: unknown;
    subtotal: unknown;
    size?: string | null;
    selections?: unknown;
    note?: string | null;
  }>;
};

/** Cupom de expedicao/caixa usado somente por destinos marcados como pedido completo. */
export function renderCompleteOrderReceipt(input: CompleteOrderReceiptInput) {
  const columns = input.paper === "58mm" ? 32 : 40;
  const divider = "-".repeat(columns);
  const businessLines = wrap(input.businessName, columns);
  businessLines[0] = `\x1B@\x1Ba\x01\x1BE\x01${businessLines[0] || ""}`;
  businessLines[businessLines.length - 1] += "\x1BE\x00";
  const lines: string[] = [...businessLines];
  if (input.businessAddress) lines.push(...wrap(input.businessAddress, columns));
  if (input.businessPhone) lines.push(...wrap(`Tel: ${input.businessPhone}`, columns));
  const orderTitleLines = wrap(`PEDIDO ${input.orderCode}`, Math.floor(columns / 2));
  orderTitleLines[0] = `\x1B!\x10${orderTitleLines[0] || ""}`;
  orderTitleLines[orderTitleLines.length - 1] += "\x1B!\x00";
  lines.push("", ...orderTitleLines, `\x1Ba\x00${divider}`, ...wrap(`Destino: ${input.pointName}`, columns));
  lines.push(...wrap(`Data: ${input.createdAt.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  })}`, columns));
  lines.push(...wrap(`Atendimento: ${formatOrigin(input.origin, input.tableName)}`, columns));

  lines.push(divider, sectionTitle("Itens", columns));
  for (const item of input.items) {
    const itemName = `${formatQuantity(item.quantity)}x ${item.name}${item.size ? ` - ${item.size}` : ""}`;
    lines.push(...wrap(itemName, columns));
    lines.push(...pair(`  ${formatQuantity(item.quantity)} x ${formatMoney(item.unitPrice)}`, formatMoney(item.subtotal), columns));
    if (Array.isArray(item.selections)) {
      for (const selection of item.selections as Array<Record<string, unknown>>) {
        const name = clean(selection?.nome || selection?.name || "Opcao");
        const group = clean(selection?.grupoNome || "");
        lines.push(...wrap(`  + ${group ? `${group}: ` : ""}${name}`, columns));
      }
    }
    if (item.note) lines.push(...wrap(`  OBS: ${item.note}`, columns));
  }

  lines.push(divider, sectionTitle("Cliente", columns));
  lines.push(...wrap(`Nome: ${input.customerName || "Nao informado"}`, columns));
  if (input.customerPhone) lines.push(...wrap(`Telefone: ${input.customerPhone}`, columns));
  if (input.customerEmail) lines.push(...wrap(`E-mail: ${input.customerEmail}`, columns));

  const address = formatAddress(input.deliveryAddress);
  lines.push(divider, sectionTitle(input.origin === "DELIVERY" ? "Endereco de entrega" : "Entrega", columns));
  if (address.length) {
    for (const addressLine of address) lines.push(...wrap(addressLine, columns));
  } else {
    lines.push(...wrap(formatOrigin(input.origin, input.tableName), columns));
  }

  if (input.orderNote) {
    lines.push(divider, sectionTitle("Observacoes do pedido", columns));
    lines.push(...wrap(input.orderNote, columns));
  }

  lines.push(divider, sectionTitle("Pagamento", columns));
  lines.push(...wrap(`Forma: ${formatPaymentMethod(input.paymentMethod)}`, columns));
  lines.push(...wrap(`Situacao: ${formatPaymentStatus(input.paymentStatus)}`, columns));
  const changeFor = Number(input.changeFor);
  if (input.paymentMethod === "DINHEIRO" && Number.isFinite(changeFor) && changeFor > 0) {
    const change = Math.max(0, changeFor - Number(input.total));
    lines.push(...wrap(`Troco para: ${formatMoney(changeFor)}`, columns));
    lines.push(...wrap(`Levar troco: ${formatMoney(change)}`, columns));
  }
  if (input.paymentStatus === "NA_ENTREGA") {
    const chargeLines = wrap("* COBRAR DO CLIENTE *", columns);
    chargeLines[0] = `\x1Ba\x01\x1BE\x01${chargeLines[0]}`;
    chargeLines[chargeLines.length - 1] += "\x1BE\x00\x1Ba\x00";
    lines.push(...chargeLines);
  }
  lines.push(...pair("Subtotal:", formatMoney(input.subtotal), columns));
  if (Number(input.discount) > 0) lines.push(...pair("Desconto:", `- ${formatMoney(input.discount)}`, columns));
  if (Number(input.deliveryFee) > 0 || input.origin === "DELIVERY") {
    lines.push(...pair("Taxa de entrega:", formatMoney(input.deliveryFee), columns));
  }
  const totalLines = pair("TOTAL:", formatMoney(input.total), columns);
  totalLines[0] = `\x1BE\x01${totalLines[0]}`;
  totalLines[totalLines.length - 1] += "\x1BE\x00";
  const footerLines = wrap(`PEDIDO ${input.orderCode}`, columns);
  footerLines[0] = `\x1Ba\x01${footerLines[0]}`;
  lines.push(
    ...totalLines,
    divider,
    ...footerLines,
    ...wrap(normalizeSystemUrl(input.systemUrl), columns),
    ...wrap(`JOB ${input.uid}`, columns),
    "",
    "\x1Bd\x03\x1DV\x00",
  );
  return lines.join("\n");
}

function renderCompleteOrderFromRecord(order: any, uid: string, paper: string, pointName: string) {
  return renderCompleteOrderReceipt({
    uid,
    paper,
    pointName,
    businessName: order.Conta.nomeFantasia || order.Conta.nome,
    businessAddress: order.Conta.endereco,
    businessPhone: order.Conta.telefone,
    systemUrl: env.BASE_URL_FRONTEND,
    orderCode: order.codigo,
    origin: order.origem,
    tableName: order.Mesa?.nome,
    customerName: order.clienteNomeSnapshot,
    customerPhone: order.clienteTelefone,
    customerEmail: order.clienteEmail,
    deliveryAddress: order.enderecoSnapshotJson,
    paymentMethod: order.pagamentoMetodoSnapshot,
    paymentStatus: order.pagamentoStatus,
    changeFor: order.trocoParaSnapshot,
    subtotal: order.subtotal,
    deliveryFee: order.frete,
    discount: order.desconto,
    total: order.total,
    orderNote: order.observacao,
    createdAt: order.createdAt,
    items: order.itens.map((item: any) => ({
      quantity: item.quantidade,
      name: item.nomeSnapshot,
      unitPrice: item.precoUnitarioSnapshot,
      subtotal: item.subtotalSnapshot,
      size: item.tamanhoSnapshot,
      selections: item.selecoesSnapshotJson,
      note: item.observacao,
    })),
  });
}

export function renderProductionTicket(input: {
  uid: string;
  paper: string;
  pointName: string;
  orderCode: string;
  origin: string;
  tableName?: string | null;
  orderNote?: string | null;
  createdAt: Date;
  items: Array<{
    quantity: string | number;
    name: string;
    size?: string | null;
    selections?: unknown;
    note?: string | null;
  }>;
}) {
  const columns = input.paper === "58mm" ? 32 : 40;
  const divider = "-".repeat(columns);
  const lines = [
    "\x1B@",
    clean(input.pointName).toUpperCase().slice(0, columns),
    `PEDIDO ${clean(input.orderCode)}`,
    `${clean(input.tableName || input.origin)} ${input.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    divider,
  ];
  for (const item of input.items) {
    lines.push(...wrap(`${Number(item.quantity)}x ${item.name}${item.size ? ` - ${item.size}` : ""}`, columns));
    if (Array.isArray(item.selections)) {
      for (const selection of item.selections as Array<any>) {
        lines.push(...wrap(`  + ${selection?.nome || selection?.name || "Opcao"}`, columns));
      }
    }
    if (item.note) lines.push(...wrap(`  OBS: ${item.note}`, columns));
  }
  if (input.orderNote) {
    lines.push(divider, ...wrap(`OBS PEDIDO: ${input.orderNote}`, columns));
  }
  lines.push(divider, `JOB ${input.uid}`, "\n\n\n\x1DV\x00");
  return lines.join("\n");
}

async function buildJobContent(tx: any, ticketId: number, fullOrder: boolean, uid: string, paper: string) {
  const ticket = await tx.restauranteTicketProducao.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      Ponto: true,
      Pedido: {
        include: {
          Mesa: true,
          itens: true,
          Conta: { select: { nome: true, nomeFantasia: true, endereco: true, telefone: true } },
        },
      },
      itens: { include: { PedidoItem: true } },
    },
  });
  const source = fullOrder
    ? ticket.Pedido.itens.map((item: any) => ({ PedidoItem: item, quantidade: item.quantidade }))
    : ticket.itens;
  if (fullOrder) {
    const order = ticket.Pedido;
    return {
      ticket,
      content: renderCompleteOrderFromRecord(order, uid, paper, ticket.Ponto.nome),
    };
  }
  return {
    ticket,
    content: renderProductionTicket({
      uid,
      paper,
      pointName: ticket.Ponto.nome,
      orderCode: ticket.Pedido.codigo,
      origin: ticket.Pedido.origem,
      tableName: ticket.Pedido.Mesa?.nome,
      orderNote: ticket.Pedido.observacao,
      createdAt: ticket.Pedido.createdAt,
      items: source.map((link: any) => ({
        quantity: link.quantidade,
        name: link.PedidoItem.nomeSnapshot,
        size: link.PedidoItem.tamanhoSnapshot,
        selections: link.PedidoItem.selecoesSnapshotJson,
        note: link.PedidoItem.observacao || link.observacao,
      })),
    }),
  };
}

export async function enqueueTicketPrintJobs(
  tx: any,
  contaId: number,
  ticketId: number,
  manualKey?: string,
  stationIds?: number[],
) {
  const ticket = await tx.restauranteTicketProducao.findFirst({
    where: { id: ticketId, contaId },
    include: {
      Ponto: {
        include: {
          regraImpressao: { include: { destinos: { orderBy: { ordem: "asc" } } } },
        },
      },
    },
  });
  const rule = ticket?.Ponto.regraImpressao;
  if (!ticket || !rule?.ativa) return [];
  const destinations = [
    {
      estacaoId: rule.estacaoId,
      fallbackEstacaoId: rule.fallbackEstacaoId,
      papel: rule.papel,
      vias: rule.vias,
      imprimirPedidoCompleto: rule.imprimirPedidoCompleto,
    },
    ...rule.destinos,
  ];
  const selectedDestinations = stationIds?.length
    ? destinations.filter((destination) => stationIds.includes(destination.estacaoId))
    : destinations;
  const jobs = [];
  const dedupeBase = manualKey || `ticket:${ticket.id}:sequencia:${ticket.sequencia}`;
  for (const destination of selectedDestinations) {
    const dedupeKey = `${dedupeBase}:destino:${destination.estacaoId}`;
    const existing = await tx.restauranteTrabalhoImpressao.findUnique({ where: { dedupeKey } });
    if (existing) {
      jobs.push(existing);
      continue;
    }
    const uid = randomUUID();
    const { content } = await buildJobContent(
      tx,
      ticket.id,
      destination.imprimirPedidoCompleto,
      uid,
      destination.papel,
    );
    jobs.push(await tx.restauranteTrabalhoImpressao.create({
      data: {
        uid,
        contaId,
        pedidoId: ticket.pedidoId,
        pontoId: ticket.pontoId,
        ticketId: ticket.id,
        estacaoId: destination.estacaoId,
        fallbackEstacaoId: destination.fallbackEstacaoId,
        dedupeKey,
        conteudo: content,
        papel: destination.papel,
        vias: destination.vias,
      },
    }));
  }
  return jobs;
}

/** Enfileira um comprovante completo diretamente, sem depender de ponto ou ticket KDS. */
export async function enqueueOrderPrintJobs(
  tx: any,
  contaId: number,
  pedidoId: number,
  stationIds: number[],
  manualKey: string,
) {
  const order = await tx.restaurantePedido.findFirst({
    where: { id: pedidoId, contaId },
    include: {
      Mesa: true,
      itens: true,
      Conta: { select: { nome: true, nomeFantasia: true, endereco: true, telefone: true } },
    },
  });
  if (!order || order.status === "RECEBIDO" || order.status === "CANCELADO") return [];
  const stations = await tx.restauranteEstacaoImpressao.findMany({
    where: { contaId, id: { in: [...new Set(stationIds)] }, ativa: true },
    select: { id: true, papelReportado: true },
  });
  const jobs = [];
  for (const station of stations) {
    const dedupeKey = `${manualKey}:destino:${station.id}`;
    const existing = await tx.restauranteTrabalhoImpressao.findUnique({ where: { dedupeKey } });
    if (existing) {
      jobs.push(existing);
      continue;
    }
    const uid = randomUUID();
    const paper = station.papelReportado === "58mm" ? "58mm" : "80mm";
    jobs.push(await tx.restauranteTrabalhoImpressao.create({
      data: {
        uid,
        contaId,
        pedidoId: order.id,
        estacaoId: station.id,
        dedupeKey,
        conteudo: renderCompleteOrderFromRecord(order, uid, paper, "Pedidos"),
        papel: paper,
        vias: 1,
      },
    }));
  }
  return jobs;
}

export async function claimStationPrintJobs(prisma: any, station: any, limit = 10) {
  const now = new Date();
  await prisma.restauranteTrabalhoImpressao.updateMany({
    where: { contaId: station.contaId, estacaoId: station.id, status: "EM_PROCESSAMENTO", leaseExpiresAt: { lt: now } },
    data: { status: "PENDENTE", leaseToken: null, leaseExpiresAt: null, proximaTentativaAt: now, erro: "Lease expirado; trabalho devolvido a fila." },
  });
  const candidates = await prisma.restauranteTrabalhoImpressao.findMany({
    where: { contaId: station.contaId, estacaoId: station.id, status: "PENDENTE", proximaTentativaAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 20),
  });
  const leaseTokens: string[] = [];
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    const claimed = await prisma.restauranteTrabalhoImpressao.updateMany({
      where: { id: candidate.id, status: "PENDENTE", estacaoId: station.id },
      data: {
        status: "EM_PROCESSAMENTO",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        tentativas: { increment: 1 },
        erro: null,
      },
    });
    if (claimed.count) leaseTokens.push(leaseToken);
  }
  return prisma.restauranteTrabalhoImpressao.findMany({
    where: { leaseToken: { in: leaseTokens } },
    orderBy: { createdAt: "asc" },
    select: { uid: true, leaseToken: true, conteudo: true, formato: true, papel: true, vias: true, tentativas: true },
  });
}

export async function acknowledgeStationPrintJob(prisma: any, station: any, input: {
  uid: string;
  leaseToken: string;
  success: boolean;
  error?: string | null;
}) {
  const job = await prisma.restauranteTrabalhoImpressao.findFirst({
    where: { uid: input.uid, contaId: station.contaId, estacaoId: station.id, status: "EM_PROCESSAMENTO", leaseToken: input.leaseToken },
  });
  if (!job) return null;
  if (input.success) {
    return prisma.restauranteTrabalhoImpressao.update({
      where: { id: job.id },
      data: { status: "CONCLUIDO", impressoAt: new Date(), leaseToken: null, leaseExpiresAt: null, erro: null },
    });
  }
  const decision = decidePrintFailure({
    attempts: job.tentativas,
    maxAttempts: job.maxTentativas,
    stationId: job.estacaoId,
    fallbackStationId: job.fallbackEstacaoId,
  });
  const error = clean(input.error || "Falha de impressao").slice(0, 2000);
  if (decision.action === "FALLBACK") {
    return prisma.restauranteTrabalhoImpressao.update({
      where: { id: job.id },
      data: { estacaoId: decision.stationId, fallbackEstacaoId: null, status: "PENDENTE", tentativas: 0, leaseToken: null, leaseExpiresAt: null, proximaTentativaAt: new Date(), erro: `Fallback: ${error}` },
    });
  }
  if (decision.action === "RETRY") {
    return prisma.restauranteTrabalhoImpressao.update({
      where: { id: job.id },
      data: { status: "PENDENTE", leaseToken: null, leaseExpiresAt: null, proximaTentativaAt: new Date(Date.now() + job.tentativas * 5_000), erro: error },
    });
  }
  return prisma.restauranteTrabalhoImpressao.update({
    where: { id: job.id },
    data: { status: "FALHOU", leaseToken: null, leaseExpiresAt: null, erro: error },
  });
}
