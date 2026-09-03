import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import Decimal from "decimal.js";
import { z } from "zod";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

const abrirSchema = z.object({
  valorInicial: z.coerce.number().min(0).max(999999.99).default(0),
  observacao: z.string().trim().max(2000).optional(),
});

const movimentoSchema = z.object({
  tipo: z.enum(["SANGRIA", "REFORCO"]),
  valor: z.coerce.number().positive().max(999999.99),
  descricao: z.string().trim().max(2000).optional(),
});

const fecharSchema = z.object({
  valorFechamento: z.coerce.number().min(0).max(999999.99),
  descricao: z.string().trim().max(2000).optional(),
  metodosContados: z
    .array(
      z.object({
        metodo: z.string().trim().min(1).max(30),
        esperado: z.coerce.number(),
        contado: z.coerce.number(),
        diferenca: z.coerce.number(),
      }),
    )
    .max(20)
    .optional(),
});

const relatorioQuerySchema = z.object({
  inicio: z.string().datetime().optional(),
  fim: z.string().datetime().optional(),
  status: z.enum(["ABERTO", "FECHADO", "CANCELADO"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const cashInclude = {
  abertoPor: { select: { id: true, nome: true } },
  fechadoPor: { select: { id: true, nome: true } },
  movimentos: {
    orderBy: { createdAt: "desc" as const },
    include: { Usuario: { select: { id: true, nome: true } } },
  },
  pedidos: {
    orderBy: { createdAt: "desc" as const },
    select: {
      id: true,
      codigo: true,
      origem: true,
      status: true,
      pagamentoStatus: true,
      pagamentoMetodoSnapshot: true,
      total: true,
      createdAt: true,
    },
  },
};

function number(value: Decimal | number | string | null | undefined) {
  return Number(value || 0);
}

function serialize(caixa: any) {
  if (!caixa) return null;
  const pedidosValidos = caixa.pedidos.filter((pedido: any) => pedido.status !== "CANCELADO");
  const porMetodo = pedidosValidos.reduce((total: Record<string, number>, pedido: any) => {
    const metodo = String(pedido.pagamentoMetodoSnapshot || "NAO_INFORMADO");
    total[metodo] = Number((total[metodo] || 0) + number(pedido.total));
    return total;
  }, {});
  const movimentos = caixa.movimentos.map((movimento: any) => ({
    ...movimento,
    valor: number(movimento.valor),
  }));
  const resumo = {
    pedidos: pedidosValidos.length,
    totalPedidos: pedidosValidos.reduce((total: number, pedido: any) => total + number(pedido.total), 0),
    porMetodo,
    totalReforcos: movimentos
      .filter((movimento: any) => movimento.tipo === "REFORCO")
      .reduce((total: number, movimento: any) => total + movimento.valor, 0),
    totalSangrias: movimentos
      .filter((movimento: any) => movimento.tipo === "SANGRIA")
      .reduce((total: number, movimento: any) => total + movimento.valor, 0),
  };
  return {
    caixa: {
      ...caixa,
      saldoInicial: number(caixa.saldoInicial),
      saldoEsperado: number(caixa.saldoEsperado),
      saldoContado: caixa.saldoContado == null ? null : number(caixa.saldoContado),
      diferenca: caixa.diferenca == null ? null : number(caixa.diferenca),
      movimentos,
      pedidos: caixa.pedidos.map((pedido: any) => ({ ...pedido, total: number(pedido.total) })),
    },
    resumo,
  };
}

function error(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function success(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ data });
}

export async function findOpenRestaurantCash(contaId: number, db = prisma) {
  return db.restauranteCaixaSessao.findFirst({
    where: { contaId, status: "ABERTO" },
    orderBy: { abertoEm: "desc" },
    select: { id: true, status: true },
  });
}

export async function requireOpenRestaurantCash(contaId: number, db = prisma) {
  const caixa = await findOpenRestaurantCash(contaId, db);
  if (!caixa) throw new RestaurantCashClosedError();
  return caixa;
}

export class RestaurantCashClosedError extends Error {
  code = "restaurant_cash_closed";
  constructor() {
    super("Abra o caixa do Restaurante antes de registrar pedidos.");
  }
}

export async function restaurantCashContext(req: Request, res: Response) {
  const { contaId } = getCustomRequest(req).customData;
  const caixa = await prisma.restauranteCaixaSessao.findFirst({
    where: { contaId, status: "ABERTO" },
    orderBy: { abertoEm: "desc" },
    include: cashInclude,
  });
  return success(res, serialize(caixa));
}

export async function restaurantCashReport(req: Request, res: Response) {
  const parsed = relatorioQuerySchema.safeParse(req.query);
  if (!parsed.success) return error(res, 422, "validation_error", "Informe filtros válidos para os caixas.");
  const { contaId } = getCustomRequest(req).customData;
  const inicio = parsed.data.inicio ? new Date(parsed.data.inicio) : undefined;
  const fim = parsed.data.fim ? new Date(parsed.data.fim) : undefined;
  if ((inicio && Number.isNaN(inicio.getTime())) || (fim && Number.isNaN(fim.getTime())) || (inicio && fim && inicio > fim)) {
    return error(res, 422, "invalid_period", "Informe um período válido.");
  }
  const where = {
    contaId,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(inicio || fim ? { abertoEm: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } } : {}),
  } as const;
  const caixas = await prisma.restauranteCaixaSessao.findMany({
    where,
    orderBy: { abertoEm: "desc" },
    include: cashInclude,
  });
  const dados = caixas.map(serialize);
  const total = dados.length;
  const totalPages = Math.max(1, Math.ceil(total / parsed.data.limit));
  const page = Math.min(parsed.data.page, totalPages);
  const caixasPagina = dados.slice((page - 1) * parsed.data.limit, page * parsed.data.limit);
  const resumo = dados.reduce(
    (acc, item) => {
      const caixa = item!.caixa;
      acc.caixas += 1;
      acc.pedidos += item!.resumo.pedidos;
      acc.totalPedidos += item!.resumo.totalPedidos;
      acc.totalReforcos += item!.resumo.totalReforcos;
      acc.totalSangrias += item!.resumo.totalSangrias;
      acc.diferenca += Number(caixa.diferenca || 0);
      return acc;
    },
    { caixas: 0, pedidos: 0, totalPedidos: 0, totalReforcos: 0, totalSangrias: 0, diferenca: 0 },
  );
  return success(res, {
    caixas: caixasPagina,
    resumo,
    pagination: {
      page,
      limit: parsed.data.limit,
      total,
      totalPages,
    },
  });
}

export async function abrirRestaurantCash(req: Request, res: Response) {
  const parsed = abrirSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 422, "validation_error", "Informe os dados de abertura do caixa.");
  const { contaId, userId } = getCustomRequest(req).customData;
  const config = await prisma.restauranteConfig.findUnique({ where: { contaId }, select: { id: true } });
  if (!config) return error(res, 422, "restaurant_not_configured", "Configure o Restaurante antes de abrir o caixa.");

  const existente = await findOpenRestaurantCash(contaId);
  if (existente) return error(res, 409, "restaurant_cash_already_open", "Já existe um caixa aberto no Restaurante.");

  const valorInicial = new Decimal(parsed.data.valorInicial).toDecimalPlaces(2);
  const caixa = await prisma.$transaction(async (tx) => {
    const created = await tx.restauranteCaixaSessao.create({
      data: {
        contaId,
        codigo: `RCX-${randomUUID().slice(0, 8).toUpperCase()}`,
        abertoPorId: userId,
        saldoInicial: valorInicial,
        saldoEsperado: valorInicial,
        observacaoAbertura: parsed.data.observacao || null,
      },
    });
    await tx.restauranteCaixaMovimento.create({
      data: {
        contaId,
        caixaId: created.id,
        usuarioId: userId,
        tipo: "ABERTURA",
        valor: valorInicial,
        descricao: parsed.data.observacao || "Abertura do caixa",
      },
    });
    return tx.restauranteCaixaSessao.findUniqueOrThrow({ where: { id: created.id }, include: cashInclude });
  });
  return success(res, serialize(caixa), 201);
}

export async function movimentarRestaurantCash(req: Request, res: Response) {
  const parsed = movimentoSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 422, "validation_error", "Informe uma sangria ou reforço válido.");
  const { contaId, userId } = getCustomRequest(req).customData;
  const atual = await findOpenRestaurantCash(contaId);
  if (!atual) return error(res, 422, "restaurant_cash_closed", "Abra o caixa antes de registrar uma movimentação.");
  const valor = new Decimal(parsed.data.valor).toDecimalPlaces(2);
  try {
    const caixa = await prisma.$transaction(async (tx) => {
      const updated = await tx.restauranteCaixaSessao.updateMany({
        where: { id: atual.id, contaId, status: "ABERTO" },
        data: {
          saldoEsperado:
            parsed.data.tipo === "SANGRIA" ? { decrement: valor } : { increment: valor },
        },
      });
      if (!updated.count) throw new RestaurantCashClosedError();
      await tx.restauranteCaixaMovimento.create({
        data: {
          contaId,
          caixaId: atual.id,
          usuarioId: userId,
          tipo: parsed.data.tipo,
          valor,
          descricao: parsed.data.descricao || null,
        },
      });
      return tx.restauranteCaixaSessao.findUniqueOrThrow({ where: { id: atual.id }, include: cashInclude });
    });
    return success(res, serialize(caixa));
  } catch (caughtError) {
    if (caughtError instanceof RestaurantCashClosedError) {
      return error(res, 409, caughtError.code, "O caixa foi fechado em outra sessão.");
    }
    throw caughtError;
  }
}

export async function fecharRestaurantCash(req: Request, res: Response) {
  const parsed = fecharSchema.safeParse(req.body);
  if (!parsed.success) return error(res, 422, "validation_error", "Informe os valores de fechamento do caixa.");
  const { contaId, userId } = getCustomRequest(req).customData;
  const atual = await prisma.restauranteCaixaSessao.findFirst({
    where: { contaId, status: "ABERTO" },
    orderBy: { abertoEm: "desc" },
  });
  if (!atual) return error(res, 422, "restaurant_cash_closed", "Não há caixa aberto para fechar.");

  const contado = new Decimal(parsed.data.valorFechamento).toDecimalPlaces(2);
  const esperado = new Decimal(atual.saldoEsperado);
  try {
    const caixa = await prisma.$transaction(async (tx) => {
      const result = await tx.restauranteCaixaSessao.updateMany({
        where: { id: atual.id, contaId, status: "ABERTO" },
        data: {
          status: "FECHADO",
          fechadoPorId: userId,
          fechadoEm: new Date(),
          saldoContado: contado,
          diferenca: contado.minus(esperado),
          fechamentoMetodos: parsed.data.metodosContados as any,
          observacaoFechamento: parsed.data.descricao || null,
        },
      });
      if (!result.count) throw new RestaurantCashClosedError();
      await tx.restauranteCaixaMovimento.create({
        data: {
          contaId,
          caixaId: atual.id,
          usuarioId: userId,
          tipo: "FECHAMENTO",
          valor: contado,
          descricao: parsed.data.descricao || "Fechamento do caixa",
        },
      });
      // O fechamento encerra a captação pública imediatamente. Pedidos manuais e
      // de mesa já exigem caixa aberto por conta própria e não usam este switch.
      await tx.restauranteConfig.updateMany({ where: { contaId }, data: { aceitarPedidosOnline: false } });
      return tx.restauranteCaixaSessao.findUniqueOrThrow({ where: { id: atual.id }, include: cashInclude });
    });
    return success(res, serialize(caixa));
  } catch (caughtError) {
    if (caughtError instanceof RestaurantCashClosedError) {
      return error(res, 409, caughtError.code, "O caixa foi fechado em outra sessão.");
    }
    throw caughtError;
  }
}
