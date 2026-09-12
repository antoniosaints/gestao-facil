import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { sendRestaurantDeliveryUpdate, sendRestaurantPublicOrderUpdate, sendRestaurantUpdate } from "../../hooks/restaurante/socket";
import { enqueueRestaurantOrderWhatsApp } from "../../services/restaurante/whatsappNotifications";
import { applyCompletedOrderFidelity } from "../../services/restaurante/loyalty";
import { withRestaurantCashOrderNumber } from "../../services/restaurante/cashOrderNumber";
import { prisma } from "../../utils/prisma";

const availabilitySchema = z.object({ disponivel: z.boolean() });
const locationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  precisaoMetros: z.coerce.number().min(0).max(10_000).nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(["RETIRADA", "EM_ROTA", "ENTREGUE", "FALHOU"]) });
const directSchema = z.object({ entregadorId: z.coerce.number().int().positive() });
const deliveryHistoryStatusSchema = z.enum(["TODAS", "ENTREGUE", "FALHOU"]);
const cancellableDeliveryStatuses = ["AGUARDANDO_DESPACHO", "OFERTADA", "ATRIBUIDA", "RETIRADA", "EM_ROTA"] as const;

function requestId(req: Request) { return String(req.headers["x-request-id"] || randomUUID()); }
function ok(req: Request, res: Response, data: unknown, status = 200, meta?: unknown) {
  return res.status(status).json({ data, ...(meta ? { meta } : {}), requestId: requestId(req) });
}
function fail(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId: requestId(req) } });
}

const deliveryOrderInclude = {
  itens: { select: { id: true, nomeSnapshot: true, quantidade: true, observacao: true } },
  Entrega: { include: { Entregador: { include: { Usuario: { select: { id: true, nome: true, telefone: true } } } } } },
} as const;

function isDeliveryOrder(order: { origem: string }) { return order.origem === "DELIVERY"; }

export async function driverContext(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const [company, offers, active] = await Promise.all([
    prisma.contas.findUnique({
      where: { id: contaId },
      select: {
        nome: true,
        nomeFantasia: true,
        profile: true,
        endereco: true,
        telefone: true,
        ParametrosConta: { select: { temaPersonalizado: true }, take: 1 },
      },
    }),
    prisma.restaurantePedido.findMany({
      where: { contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] }, entregaStatus: "OFERTADA", Entrega: { is: { entregadorId: null } } },
      orderBy: { createdAt: "asc" }, take: 20, include: deliveryOrderInclude,
    }),
    prisma.restaurantePedido.findFirst({
      where: { contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] }, entregaStatus: { in: ["ATRIBUIDA", "RETIRADA", "EM_ROTA"] }, Entrega: { is: { entregadorId: driver.id } } },
      orderBy: { updatedAt: "desc" }, include: deliveryOrderInclude,
    }),
  ]);
  const empresa = company
    ? (() => {
        const { ParametrosConta, ...companyData } = company;
        return { ...companyData, temaPersonalizado: ParametrosConta[0]?.temaPersonalizado ?? null };
      })()
    : null;
  const [ofertas, entregaAtiva] = await Promise.all([
    withRestaurantCashOrderNumber(prisma, offers),
    active ? withRestaurantCashOrderNumber(prisma, [active]).then(([pedido]) => pedido) : Promise.resolve(null),
  ]);
  return ok(req, res, { driver, empresa, ofertas, entregaAtiva });
}

/** Histórico pessoal do entregador autenticado. Nunca aceita ID de entregador pelo cliente. */
export async function driverDeliveryHistory(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const where = {
    contaId,
    origem: "DELIVERY" as const,
    entregaStatus: { in: ["ENTREGUE", "FALHOU", "CANCELADA"] as ("ENTREGUE" | "FALHOU" | "CANCELADA")[] },
    Entrega: { is: { entregadorId: driver.id } },
  };
  const [items, total] = await Promise.all([
    prisma.restaurantePedido.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: deliveryOrderInclude,
    }),
    prisma.restaurantePedido.count({ where }),
  ]);
  return ok(req, res, await withRestaurantCashOrderNumber(prisma, items), 200, { page, limit, total, pages: Math.ceil(total / limit) });
}

export async function updateDriverAvailability(req: Request, res: Response) {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Disponibilidade invalida.", parsed.error.flatten());
  const driver = await prisma.restauranteEntregador.update({ where: { id: req.restauranteEntregador!.id }, data: parsed.data });
  return ok(req, res, driver);
}

export async function acceptDelivery(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const pedidoId = Number(req.params.pedidoId);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) return fail(req, res, 422, "invalid_order", "Pedido invalido.");

  const accepted = await prisma.$transaction(async (tx) => {
    const claimed = await tx.restauranteEntrega.updateMany({
      where: { pedidoId, contaId, entregadorId: null, Pedido: { entregaStatus: "OFERTADA", origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] } } },
      data: { entregadorId: driver.id, atribuidaAt: new Date() },
    });
    if (!claimed.count) return null;
    await tx.restaurantePedido.updateMany({ where: { id: pedidoId, contaId, status: { notIn: ["CANCELADO", "CONCLUIDO"] }, entregaStatus: "OFERTADA" }, data: { entregaStatus: "ATRIBUIDA", version: { increment: 1 } } });
    return tx.restaurantePedido.findFirst({ where: { id: pedidoId, contaId }, include: deliveryOrderInclude });
  });
  if (!accepted) return fail(req, res, 409, "delivery_unavailable", "Esta entrega ja foi aceita por outro entregador.");
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, (await withRestaurantCashOrderNumber(prisma, [accepted]))[0]);
}

/** Encerra entregas ainda abertas de um pedido que já foi cancelado. */
export async function cancelDelivery(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const pedidoId = Number(req.params.pedidoId);
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) return fail(req, res, 422, "invalid_order", "Pedido invalido.");

  const now = new Date();
  const cancelled = await prisma.$transaction(async (tx) => {
    const changed = await tx.restaurantePedido.updateMany({
      where: {
        id: pedidoId,
        contaId,
        origem: "DELIVERY",
        status: "CANCELADO",
        entregaStatus: { in: [...cancellableDeliveryStatuses] },
      },
      data: { entregaStatus: "CANCELADA", version: { increment: 1 } },
    });
    if (!changed.count) return null;
    await tx.restauranteEntrega.updateMany({
      where: { pedidoId, contaId },
      data: { canceladaAt: now },
    });
    return tx.restaurantePedido.findFirst({ where: { id: pedidoId, contaId }, include: deliveryOrderInclude });
  });
  if (!cancelled) return fail(req, res, 409, "delivery_not_cancellable", "Esta entrega não está aberta para cancelamento.");
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, (await withRestaurantCashOrderNumber(prisma, [cancelled]))[0]);
}

export async function updateDeliveryStatus(req: Request, res: Response) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Status de entrega invalido.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId, status: { notIn: ["CANCELADO", "CONCLUIDO"] } }, include: { Entrega: true } });
  if (!order || !isDeliveryOrder(order) || order.Entrega?.entregadorId !== driver.id) return fail(req, res, 404, "delivery_not_found", "Entrega nao encontrada para este entregador.");
  const allowed: Record<string, string[]> = { ATRIBUIDA: ["RETIRADA", "FALHOU"], RETIRADA: ["EM_ROTA", "FALHOU"], EM_ROTA: ["ENTREGUE", "FALHOU"] };
  if (!allowed[order.entregaStatus]?.includes(parsed.data.status)) return fail(req, res, 422, "invalid_delivery_transition", "Esta transicao de entrega nao e permitida.");
  if (parsed.data.status === "RETIRADA" && order.status !== "PRONTO") {
    return fail(req, res, 422, "delivery_order_not_ready", "A retirada só pode ser confirmada quando o pedido estiver pronto.");
  }
  const now = new Date();
  const timeField = { RETIRADA: "retiradaAt", EM_ROTA: "emRotaAt", ENTREGUE: "entregueAt", FALHOU: "falhouAt" }[parsed.data.status]!;
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.restaurantePedido.updateMany({
      where: {
        id: order.id,
        contaId,
        entregaStatus: order.entregaStatus,
        ...(parsed.data.status === "RETIRADA" ? { status: "PRONTO" } : {}),
      },
      data: {
        entregaStatus: parsed.data.status,
        version: { increment: 1 },
        ...(parsed.data.status === "ENTREGUE" ? { status: "CONCLUIDO", concluidoAt: now } : {}),
      },
    });
    if (!changed.count) return null;
    await tx.restauranteEntrega.update({ where: { id: order.Entrega!.id }, data: { [timeField]: now } });
    if (parsed.data.status === "ENTREGUE") await applyCompletedOrderFidelity(tx, contaId, order.id);
    return tx.restaurantePedido.findFirst({ where: { id: order.id, contaId }, include: deliveryOrderInclude });
  });
  if (!updated) return fail(req, res, 409, "delivery_transition_conflict", "O pedido foi atualizado. Atualize a tela antes de confirmar a retirada.");
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  if (parsed.data.status === "EM_ROTA") void enqueueRestaurantOrderWhatsApp(pedidoId, "SAIU_ENTREGA");
  if (parsed.data.status === "ENTREGUE") void enqueueRestaurantOrderWhatsApp(pedidoId, "ENTREGUE");
  return ok(req, res, (await withRestaurantCashOrderNumber(prisma, [updated]))[0]);
}

export async function publishDriverLocation(req: Request, res: Response) {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Localizacao invalida.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({
    where: { id: pedidoId, contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] }, entregaStatus: "EM_ROTA" },
    include: { Entrega: { include: { Entregador: { include: { Usuario: { select: { nome: true } } } } } } },
  });
  if (!order || order.Entrega?.entregadorId !== driver.id) return fail(req, res, 409, "location_not_allowed", "A localizacao so pode ser enviada durante a rota ativa.");
  const data = parsed.data;
  const now = new Date();
  await prisma.$transaction([
    prisma.restauranteEntregador.update({ where: { id: driver.id }, data: { ultimaLatitude: data.latitude, ultimaLongitude: data.longitude, ultimaLocalizacaoAt: now } }),
    prisma.restauranteEntregaLocalizacao.create({ data: { contaId, entregaId: order.Entrega.id, latitude: data.latitude, longitude: data.longitude, precisaoMetros: data.precisaoMetros ?? null, createdAt: now } }),
  ]);
  sendRestaurantDeliveryUpdate(contaId, {
    pedidoId,
    latitude: data.latitude,
    longitude: data.longitude,
    updatedAt: now.toISOString(),
    entregadorNome: order.Entrega.Entregador?.Usuario.nome,
  });
  return ok(req, res, { updatedAt: now });
}

/** Fila de despacho para a central: ofertar para todos ou indicar um entregador. */
export async function listDeliveryDispatch(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const [orders, drivers] = await Promise.all([
    prisma.restaurantePedido.findMany({ where: { contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] }, entregaStatus: { in: ["AGUARDANDO_DESPACHO", "OFERTADA", "ATRIBUIDA", "RETIRADA", "EM_ROTA"] } }, orderBy: { createdAt: "desc" }, take: 100, include: deliveryOrderInclude }),
    prisma.restauranteEntregador.findMany({
      where: { contaId, ativo: true },
      include: { Usuario: { select: { id: true, nome: true, telefone: true } } },
      orderBy: { Usuario: { nome: "asc" } },
    }),
  ]);
  return ok(req, res, { pedidos: await withRestaurantCashOrderNumber(prisma, orders), entregadores: drivers });
}

function deliveryHistoryPeriod(req: Request) {
  const now = new Date();
  const fallbackStart = new Date(now);
  fallbackStart.setDate(fallbackStart.getDate() - 29);
  fallbackStart.setHours(0, 0, 0, 0);
  const inicio = typeof req.query.inicio === "string" ? new Date(req.query.inicio) : fallbackStart;
  const fim = typeof req.query.fim === "string" ? new Date(req.query.fim) : now;
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) return null;
  if (fim.getTime() - inicio.getTime() > 366 * 24 * 60 * 60 * 1000) return null;
  return { inicio, fim };
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? Math.round((valid.reduce((total, value) => total + value, 0) / valid.length) * 10) / 10 : null;
}

function deliveryMinutes(start?: Date | null, end?: Date | null) {
  if (!start || !end) return null;
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  return minutes >= 0 ? minutes : null;
}

/** Histórico administrativo de entregas finalizadas, com resumo por entregador. */
export async function deliveryHistory(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const period = deliveryHistoryPeriod(req);
  if (!period) return fail(req, res, 422, "invalid_period", "Informe um período de até 366 dias.");
  const statusParsed = deliveryHistoryStatusSchema.safeParse(req.query.situacao || "ENTREGUE");
  if (!statusParsed.success) return fail(req, res, 422, "invalid_delivery_status", "Situação de entrega inválida.");
  const driverIdRaw = typeof req.query.entregadorId === "string" ? Number(req.query.entregadorId) : null;
  if (driverIdRaw !== null && (!Number.isInteger(driverIdRaw) || driverIdRaw <= 0))
    return fail(req, res, 422, "invalid_driver", "Entregador inválido.");
  if (driverIdRaw !== null) {
    const driver = await prisma.restauranteEntregador.findFirst({ where: { id: driverIdRaw, contaId } });
    if (!driver) return fail(req, res, 422, "driver_not_found", "Entregador não encontrado.");
  }

  const terminalFilters: Record<z.infer<typeof deliveryHistoryStatusSchema>, any[]> = {
    ENTREGUE: [{ entregueAt: { gte: period.inicio, lte: period.fim }, Pedido: { origem: "DELIVERY", entregaStatus: "ENTREGUE" } }],
    FALHOU: [{ falhouAt: { gte: period.inicio, lte: period.fim }, Pedido: { origem: "DELIVERY", entregaStatus: "FALHOU" } }],
    TODAS: [
      { entregueAt: { gte: period.inicio, lte: period.fim }, Pedido: { origem: "DELIVERY", entregaStatus: "ENTREGUE" } },
      { falhouAt: { gte: period.inicio, lte: period.fim }, Pedido: { origem: "DELIVERY", entregaStatus: "FALHOU" } },
    ],
  };
  const where: any = {
    contaId,
    ...(driverIdRaw !== null ? { entregadorId: driverIdRaw } : {}),
    OR: terminalFilters[statusParsed.data],
  };
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const include = {
    Entregador: { include: { Usuario: { select: { nome: true } } } },
    Pedido: {
      select: {
        id: true, restauranteCaixaId: true, codigo: true, clienteNomeSnapshot: true, total: true, status: true, entregaStatus: true, createdAt: true, concluidoAt: true,
      },
    },
  } as const;
  const [entries, allEntries, total, drivers] = await Promise.all([
    prisma.restauranteEntrega.findMany({ where, include, skip: (page - 1) * limit, take: limit, orderBy: { updatedAt: "desc" } }),
    prisma.restauranteEntrega.findMany({ where, include, orderBy: { updatedAt: "desc" } }),
    prisma.restauranteEntrega.count({ where }),
    prisma.restauranteEntregador.findMany({
      where: { contaId },
      select: { id: true, ativo: true, Usuario: { select: { nome: true } } },
      orderBy: { Usuario: { nome: "asc" } },
    }),
  ]);

  type DriverSummary = { id: number; nome: string; entregas: number; falhas: number; valor: number; tempos: Array<number | null> };
  const byDriver = new Map<number, DriverSummary>();
  let deliveries = 0;
  let failures = 0;
  let totalValue = 0;
  for (const entry of allEntries) {
    const driverId = entry.entregadorId || 0;
    const driver: DriverSummary = byDriver.get(driverId) || {
      id: driverId,
      nome: entry.Entregador?.Usuario.nome || "Sem entregador",
      entregas: 0,
      falhas: 0,
      valor: 0,
      tempos: [],
    };
    if (entry.Pedido.entregaStatus === "ENTREGUE") {
      const value = Number(entry.Pedido.total);
      deliveries += 1;
      totalValue += value;
      driver.entregas += 1;
      driver.valor += value;
      driver.tempos.push(deliveryMinutes(entry.emRotaAt, entry.entregueAt));
    } else {
      failures += 1;
      driver.falhas += 1;
    }
    byDriver.set(driverId, driver);
  }
  const driverSummary = [...byDriver.values()]
    .map(({ tempos, ...driver }) => ({
      ...driver,
      valor: Math.round(driver.valor * 100) / 100,
      ticketMedio: driver.entregas ? Math.round((driver.valor / driver.entregas) * 100) / 100 : 0,
      tempoMedioEntregaMinutos: average(tempos),
    }))
    .sort((first, second) => second.entregas - first.entregas || second.valor - first.valor);
  const deliveryTimes = allEntries
    .filter((entry) => entry.Pedido.entregaStatus === "ENTREGUE")
    .map((entry) => deliveryMinutes(entry.emRotaAt, entry.entregueAt));

  const pedidosVisuais = await withRestaurantCashOrderNumber(prisma, entries.map((entry) => entry.Pedido));
  const codigoPorPedido = new Map(pedidosVisuais.map((pedido) => [pedido.id, pedido.codigo]));
  return ok(req, res, {
    periodo: { inicio: period.inicio.toISOString(), fim: period.fim.toISOString() },
    resumo: {
      entregas: deliveries,
      falhas: failures,
      valor: Math.round(totalValue * 100) / 100,
      ticketMedio: deliveries ? Math.round((totalValue / deliveries) * 100) / 100 : 0,
      tempoMedioEntregaMinutos: average(deliveryTimes),
    },
    entregadores: driverSummary,
    pedidos: entries.map((entry) => ({
      pedidoId: entry.Pedido.id,
      codigo: codigoPorPedido.get(entry.Pedido.id) || entry.Pedido.codigo,
      clienteNome: entry.Pedido.clienteNomeSnapshot,
      total: entry.Pedido.total,
      status: entry.Pedido.status,
      entregaStatus: entry.Pedido.entregaStatus,
      criadoEm: entry.Pedido.createdAt,
      finalizadoEm: entry.entregueAt || entry.falhouAt,
      entregador: entry.Entregador ? { id: entry.Entregador.id, nome: entry.Entregador.Usuario.nome } : null,
      retiradaEm: entry.retiradaAt,
      emRotaEm: entry.emRotaAt,
    })),
    filtros: { entregadores: drivers.map((driver) => ({ id: driver.id, nome: driver.Usuario.nome, ativo: driver.ativo })) },
    meta: { page, pages: Math.ceil(total / limit), total },
  });
}

export async function offerDelivery(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] } } });
  if (!order) return fail(req, res, 404, "order_not_found", "Pedido delivery nao encontrado.");
  if (order.entregaStatus !== "AGUARDANDO_DESPACHO") return fail(req, res, 422, "delivery_not_dispatchable", "Este pedido nao esta aguardando despacho.");
  const now = new Date();
  const delivery = await prisma.$transaction(async (tx) => {
    const entry = await tx.restauranteEntrega.upsert({ where: { pedidoId }, create: { contaId, pedidoId, ofertadaAt: now }, update: { entregadorId: null, ofertadaAt: now, atribuidaAt: null } });
    await tx.restaurantePedido.update({ where: { id: pedidoId }, data: { entregaStatus: "OFERTADA", version: { increment: 1 } } });
    return entry;
  });
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, delivery);
}

export async function directDelivery(req: Request, res: Response) {
  const parsed = directSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Entregador invalido.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const pedidoId = Number(req.params.pedidoId);
  const [order, driver] = await Promise.all([
    prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId, origem: "DELIVERY", status: { notIn: ["CANCELADO", "CONCLUIDO"] } } }),
    prisma.restauranteEntregador.findFirst({ where: { id: parsed.data.entregadorId, contaId, ativo: true } }),
  ]);
  if (!order) return fail(req, res, 404, "order_not_found", "Pedido delivery nao encontrado.");
  if (!driver) return fail(req, res, 422, "driver_not_found", "Entregador ativo nao encontrado.");
  if (!["AGUARDANDO_DESPACHO", "OFERTADA"].includes(order.entregaStatus)) return fail(req, res, 422, "delivery_not_dispatchable", "Este pedido ja esta em entrega.");
  const now = new Date();
  const delivery = await prisma.$transaction(async (tx) => {
    const entry = await tx.restauranteEntrega.upsert({ where: { pedidoId }, create: { contaId, pedidoId, entregadorId: driver.id, atribuidaAt: now }, update: { entregadorId: driver.id, atribuidaAt: now } });
    await tx.restaurantePedido.update({ where: { id: pedidoId }, data: { entregaStatus: "ATRIBUIDA", version: { increment: 1 } } });
    return entry;
  });
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, delivery);
}
