import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

function requestId(req: Request) { return String(req.headers["x-request-id"] || randomUUID()); }
function ok(req: Request, res: Response, data: unknown) { return res.status(200).json({ data, requestId: requestId(req) }); }
function fail(req: Request, res: Response, message: string) { return res.status(422).json({ error: { code: "invalid_period", message, requestId: requestId(req) } }); }

function parsePeriod(req: Request) {
  const now = new Date();
  const fallbackStart = new Date(now);
  fallbackStart.setDate(fallbackStart.getDate() - 29);
  fallbackStart.setHours(0, 0, 0, 0);
  const inicio = typeof req.query.inicio === "string" ? new Date(req.query.inicio) : fallbackStart;
  const fim = typeof req.query.fim === "string" ? new Date(req.query.fim) : now;
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) return null;
  const maxRange = 366 * 24 * 60 * 60 * 1000;
  if (fim.getTime() - inicio.getTime() > maxRange) return null;
  return { inicio, fim };
}

function minutesBetween(start?: Date | null, end?: Date | null) {
  if (!start || !end) return null;
  const value = (end.getTime() - start.getTime()) / 60_000;
  return value >= 0 ? value : null;
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? Math.round((valid.reduce((total, value) => total + value, 0) / valid.length) * 10) / 10 : null;
}

export async function restaurantDashboard(req: Request, res: Response) {
  const period = parsePeriod(req);
  if (!period) return fail(req, res, "O período deve ter no máximo 366 dias e uma data inicial anterior à final.");
  const { contaId } = getCustomRequest(req).customData;
  const periodWhere = { contaId, createdAt: { gte: period.inicio, lte: period.fim } };
  const validWhere = { ...periodWhere, status: { not: "CANCELADO" as const } };

  const [orders, items, activeOrders] = await Promise.all([
    prisma.restaurantePedido.findMany({
      where: periodWhere,
      select: {
        id: true, codigo: true, status: true, origem: true, total: true, pagamentoMetodoSnapshot: true, createdAt: true,
        emPreparoAt: true, prontoAt: true,
        Entrega: { select: { atribuidaAt: true, retiradaAt: true, emRotaAt: true, entregueAt: true, falhouAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.restaurantePedidoItem.findMany({
      where: { Pedido: validWhere },
      select: { nomeSnapshot: true, quantidade: true, subtotalSnapshot: true },
    }),
    prisma.restaurantePedido.count({
      where: { contaId, status: { in: ["RECEBIDO", "CONFIRMADO", "EM_PREPARO", "PRONTO"] } },
    }),
  ]);

  const validOrders = orders.filter((order) => order.status !== "CANCELADO");
  const cancelled = orders.filter((order) => order.status === "CANCELADO").length;
  const revenue = validOrders.reduce((total, order) => total + Number(order.total), 0);
  const productMap = new Map<string, { quantidade: number; faturamento: number }>();
  for (const item of items) {
    const current = productMap.get(item.nomeSnapshot) || { quantidade: 0, faturamento: 0 };
    current.quantidade += Number(item.quantidade);
    current.faturamento += Number(item.subtotalSnapshot);
    productMap.set(item.nomeSnapshot, current);
  }
  const produtosMaisVendidos = [...productMap.entries()]
    .map(([nome, values]) => ({ nome, ...values }))
    .sort((a, b) => b.quantidade - a.quantidade || b.faturamento - a.faturamento)
    .slice(0, 6);
  const paymentMap = new Map<string, { pedidos: number; valor: number }>();
  const originMap = new Map<string, { pedidos: number; valor: number }>();
  const dayMap = new Map<string, { pedidos: number; valor: number }>();
  for (const order of validOrders) {
    const payment = order.pagamentoMetodoSnapshot || "Não informado";
    const paymentCurrent = paymentMap.get(payment) || { pedidos: 0, valor: 0 };
    paymentCurrent.pedidos += 1; paymentCurrent.valor += Number(order.total); paymentMap.set(payment, paymentCurrent);
    const originCurrent = originMap.get(order.origem) || { pedidos: 0, valor: 0 };
    originCurrent.pedidos += 1; originCurrent.valor += Number(order.total); originMap.set(order.origem, originCurrent);
    const day = order.createdAt.toISOString().slice(0, 10);
    const dayCurrent = dayMap.get(day) || { pedidos: 0, valor: 0 };
    dayCurrent.pedidos += 1; dayCurrent.valor += Number(order.total); dayMap.set(day, dayCurrent);
  }
  const formasPagamento = [...paymentMap.entries()].map(([metodo, values]) => ({ metodo, ...values })).sort((a, b) => b.valor - a.valor);
  const canais = [...originMap.entries()].map(([origem, values]) => ({ origem, ...values })).sort((a, b) => b.valor - a.valor);
  const vendasPorDia = [...dayMap.entries()].map(([data, values]) => ({ data, ...values }));
  const productionTimes = validOrders.map((order) => minutesBetween(order.emPreparoAt, order.prontoAt));
  const deliveryTimes = validOrders.map((order) => minutesBetween(order.Entrega?.emRotaAt, order.Entrega?.entregueAt));
  const acceptanceTimes = validOrders.map((order) => minutesBetween(order.Entrega?.atribuidaAt, order.Entrega?.retiradaAt));

  return ok(req, res, {
    periodo: { inicio: period.inicio.toISOString(), fim: period.fim.toISOString() },
    resumo: {
      pedidos: orders.length,
      faturamento: Math.round(revenue * 100) / 100,
      ticketMedio: validOrders.length ? Math.round((revenue / validOrders.length) * 100) / 100 : 0,
      cancelamentos: cancelled,
      taxaCancelamento: orders.length ? Math.round((cancelled / orders.length) * 1000) / 10 : 0,
      pedidosEmAberto: activeOrders,
    },
    operacao: {
      tempoMedioProducaoMinutos: average(productionTimes),
      pedidosComTempoProducao: productionTimes.filter((value) => value !== null).length,
      tempoMedioEntregaMinutos: average(deliveryTimes),
      entregasConcluidas: deliveryTimes.filter((value) => value !== null).length,
      tempoMedioRetiradaMinutos: average(acceptanceTimes),
    },
    produtosMaisVendidos,
    formasPagamento,
    canais,
    vendasPorDia,
  });
}
