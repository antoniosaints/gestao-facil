import { createHash, randomUUID } from "node:crypto";

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
  for (const word of words) {
    if (!current) current = word.slice(0, columns);
    else if (`${current} ${word}`.length <= columns) current += ` ${word}`;
    else {
      lines.push(current);
      current = word.slice(0, columns);
    }
  }
  if (current) lines.push(current);
  return lines;
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
      Pedido: { include: { Mesa: true, itens: true } },
      itens: { include: { PedidoItem: true } },
    },
  });
  const source = fullOrder
    ? ticket.Pedido.itens.map((item: any) => ({ PedidoItem: item, quantidade: item.quantidade }))
    : ticket.itens;
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

export async function enqueueTicketPrintJobs(tx: any, contaId: number, ticketId: number, manualKey?: string) {
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
  const jobs = [];
  const dedupeBase = manualKey || `ticket:${ticket.id}:sequencia:${ticket.sequencia}`;
  for (const destination of destinations) {
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
