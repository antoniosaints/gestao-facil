import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { sendRestaurantDeliveryUpdate, sendRestaurantPublicOrderUpdate, sendRestaurantUpdate } from "../../hooks/restaurante/socket";
import { prisma } from "../../utils/prisma";

const availabilitySchema = z.object({ disponivel: z.boolean() });
const locationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  precisaoMetros: z.coerce.number().min(0).max(10_000).nullable().optional(),
});
const statusSchema = z.object({ status: z.enum(["RETIRADA", "EM_ROTA", "ENTREGUE", "FALHOU"]) });
const directSchema = z.object({ entregadorId: z.coerce.number().int().positive() });

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
    prisma.contas.findUnique({ where: { id: contaId }, select: { nome: true, nomeFantasia: true, profile: true, endereco: true, telefone: true } }),
    prisma.restaurantePedido.findMany({
      where: { contaId, origem: "DELIVERY", entregaStatus: "OFERTADA", Entrega: { is: { entregadorId: null } } },
      orderBy: { createdAt: "asc" }, take: 20, include: deliveryOrderInclude,
    }),
    prisma.restaurantePedido.findFirst({
      where: { contaId, origem: "DELIVERY", entregaStatus: { in: ["ATRIBUIDA", "RETIRADA", "EM_ROTA"] }, Entrega: { is: { entregadorId: driver.id } } },
      orderBy: { updatedAt: "desc" }, include: deliveryOrderInclude,
    }),
  ]);
  return ok(req, res, { driver, empresa: company, ofertas: offers, entregaAtiva: active });
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
    entregaStatus: { in: ["ENTREGUE", "FALHOU"] },
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
  return ok(req, res, items, 200, { page, limit, total, pages: Math.ceil(total / limit) });
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
      where: { pedidoId, contaId, entregadorId: null, Pedido: { entregaStatus: "OFERTADA", origem: "DELIVERY" } },
      data: { entregadorId: driver.id, atribuidaAt: new Date() },
    });
    if (!claimed.count) return null;
    await tx.restaurantePedido.updateMany({ where: { id: pedidoId, contaId, entregaStatus: "OFERTADA" }, data: { entregaStatus: "ATRIBUIDA", version: { increment: 1 } } });
    return tx.restaurantePedido.findFirst({ where: { id: pedidoId, contaId }, include: deliveryOrderInclude });
  });
  if (!accepted) return fail(req, res, 409, "delivery_unavailable", "Esta entrega ja foi aceita por outro entregador.");
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, accepted);
}

export async function updateDeliveryStatus(req: Request, res: Response) {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Status de entrega invalido.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId }, include: { Entrega: true } });
  if (!order || !isDeliveryOrder(order) || order.Entrega?.entregadorId !== driver.id) return fail(req, res, 404, "delivery_not_found", "Entrega nao encontrada para este entregador.");
  const allowed: Record<string, string[]> = { ATRIBUIDA: ["RETIRADA", "FALHOU"], RETIRADA: ["EM_ROTA", "FALHOU"], EM_ROTA: ["ENTREGUE", "FALHOU"] };
  if (!allowed[order.entregaStatus]?.includes(parsed.data.status)) return fail(req, res, 422, "invalid_delivery_transition", "Esta transicao de entrega nao e permitida.");
  const now = new Date();
  const timeField = { RETIRADA: "retiradaAt", EM_ROTA: "emRotaAt", ENTREGUE: "entregueAt", FALHOU: "falhouAt" }[parsed.data.status]!;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.restauranteEntrega.update({ where: { id: order.Entrega!.id }, data: { [timeField]: now } });
    return tx.restaurantePedido.update({ where: { id: order.id }, data: { entregaStatus: parsed.data.status, version: { increment: 1 } }, include: deliveryOrderInclude });
  });
  sendRestaurantUpdate(contaId, "pedido", { pedidoId });
  sendRestaurantPublicOrderUpdate(pedidoId, { pedidoId });
  return ok(req, res, updated);
}

export async function publishDriverLocation(req: Request, res: Response) {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) return fail(req, res, 422, "validation_error", "Localizacao invalida.", parsed.error.flatten());
  const { contaId } = getCustomRequest(req).customData;
  const driver = req.restauranteEntregador!;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({
    where: { id: pedidoId, contaId, origem: "DELIVERY", entregaStatus: "EM_ROTA" },
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
    prisma.restaurantePedido.findMany({ where: { contaId, origem: "DELIVERY", entregaStatus: { in: ["AGUARDANDO_DESPACHO", "OFERTADA", "ATRIBUIDA", "RETIRADA", "EM_ROTA"] } }, orderBy: { createdAt: "desc" }, take: 100, include: deliveryOrderInclude }),
    prisma.restauranteEntregador.findMany({
      where: { contaId, ativo: true },
      include: { Usuario: { select: { id: true, nome: true, telefone: true } } },
      orderBy: { Usuario: { nome: "asc" } },
    }),
  ]);
  return ok(req, res, { pedidos: orders, entregadores: drivers });
}

export async function offerDelivery(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const pedidoId = Number(req.params.pedidoId);
  const order = await prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId, origem: "DELIVERY" } });
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
    prisma.restaurantePedido.findFirst({ where: { id: pedidoId, contaId, origem: "DELIVERY" } }),
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
