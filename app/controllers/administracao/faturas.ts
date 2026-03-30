import { Request, Response } from "express";
import { differenceInCalendarDays, format, startOfDay, subDays } from "date-fns";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { assertSuperAdmin } from "./assinantes";
import { renovarVencimento } from "../asaas/hooks";
import { clearCacheAccount } from "./contas";
import { reconcileStoreModulesAfterPayment } from "../../services/contas/storeModulesService";

const ALLOWED_SORT_FIELDS = new Set([
  "id",
  "vencimento",
  "valor",
  "status",
  "criadoEm",
]);

function ensureValidStatus(status: string) {
  return ["PENDENTE", "PAGO", "ATRASADO", "CANCELADO"].includes(status);
}

export const tableFaturasAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar essas faturas.",
      });
    }

    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const pageSize = Number(req.query.pageSize) > 0 ? Number(req.query.pageSize) : 10;
    const search = String(req.query.search || "").trim();
    const requestedSortBy = String(req.query.sortBy || "id");
    const sortBy = ALLOWED_SORT_FIELDS.has(requestedSortBy) ? requestedSortBy : "id";
    const order: Prisma.SortOrder = req.query.order === "desc" ? "desc" : "asc";
    const statusFilter = String(req.query.status || "TODOS").toUpperCase();

    const where: Prisma.FaturasContasWhereInput = {};

    if (statusFilter !== "TODOS" && ensureValidStatus(statusFilter)) {
      where.status = statusFilter as any;
    }

    if (search) {
      where.OR = [
        { Uid: { contains: search } },
        { asaasPaymentId: { contains: search } },
        { descricao: { contains: search } },
        { conta: { nome: { contains: search } } },
        { conta: { nomeFantasia: { contains: search } } },
        { conta: { email: { contains: search } } },
      ];
    }

    const [total, faturas] = await Promise.all([
      prisma.faturasContas.count({ where }),
      prisma.faturasContas.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: {
          [sortBy]: order,
        },
        include: {
          conta: {
            select: {
              id: true,
              nome: true,
              nomeFantasia: true,
              email: true,
              telefone: true,
              gateway: true,
              status: true,
              vencimento: true,
            },
          },
        },
      }),
    ]);

    const today = startOfDay(new Date());
    const data = faturas.map((fatura) => {
      const dueDate = startOfDay(fatura.vencimento);
      return {
        id: fatura.id,
        Uid: fatura.Uid,
        asaasPaymentId: fatura.asaasPaymentId,
        descricao: fatura.descricao,
        vencimento: fatura.vencimento,
        valor: Number(fatura.valor || 0),
        urlPagamento: fatura.urlPagamento,
        status: fatura.status,
        criadoEm: fatura.criadoEm,
        diasParaVencer: differenceInCalendarDays(dueDate, today),
        conta: {
          id: fatura.conta.id,
          nome: fatura.conta.nome,
          nomeFantasia: fatura.conta.nomeFantasia,
          email: fatura.conta.email,
          telefone: fatura.conta.telefone,
          gateway: fatura.conta.gateway,
          status: fatura.conta.status,
          vencimento: fatura.conta.vencimento,
        },
      };
    });

    return res.json({
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const manageFaturaAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para gerenciar essas faturas.",
      });
    }

    const faturaId = Number(req.params.id);
    const status = String(req.body?.status || "").toUpperCase();
    const vencimentoRaw = req.body?.vencimento;
    const descricao = typeof req.body?.descricao === "string" ? req.body.descricao.trim() : undefined;

    if (!faturaId) {
      return res.status(400).json({ message: "Fatura inválida." });
    }

    if (!ensureValidStatus(status)) {
      return res.status(400).json({ message: "Status inválido para a fatura." });
    }

    const fatura = await prisma.faturasContas.findUniqueOrThrow({
      where: { id: faturaId },
      include: {
        conta: true,
      },
    });

    const updateData: Prisma.FaturasContasUpdateInput = {
      status: status as any,
    };

    if (descricao !== undefined) {
      updateData.descricao = descricao || null;
    }

    if (vencimentoRaw) {
      const vencimento = new Date(vencimentoRaw);
      if (Number.isNaN(vencimento.getTime())) {
        return res.status(400).json({ message: "Data de vencimento inválida." });
      }
      updateData.vencimento = vencimento;
    }

    const previousDueDate = fatura.conta.vencimento;
    const now = new Date();

    await prisma.faturasContas.update({
      where: { id: faturaId },
      data: updateData,
    });

    if (status === "PAGO") {
      const novoVencimento = new Date(renovarVencimento(fatura.conta.vencimento, now.toISOString()));
      await prisma.contas.update({
        where: { id: fatura.contaId },
        data: {
          status: "ATIVO",
          vencimento: novoVencimento,
        },
      });
      await reconcileStoreModulesAfterPayment(fatura.contaId, previousDueDate, novoVencimento);
      await clearCacheAccount(fatura.contaId);
    }

    if (status === "ATRASADO") {
      const forcedDueDate = subDays(new Date(), 1);
      await prisma.contas.update({
        where: { id: fatura.contaId },
        data: {
          status: "BLOQUEADO",
          vencimento: forcedDueDate,
        },
      });
      await clearCacheAccount(fatura.contaId);
    }

    const updated = await prisma.faturasContas.findUniqueOrThrow({
      where: { id: faturaId },
      include: {
        conta: {
          select: {
            id: true,
            nome: true,
            email: true,
            status: true,
            vencimento: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: "Fatura atualizada com sucesso.",
      data: updated,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getDashboardFaturasAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);

    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar o dashboard.",
      });
    }

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const startWindow = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [contas, faturas] = await Promise.all([
      prisma.contas.findMany({
        select: {
          id: true,
          nome: true,
          nomeFantasia: true,
          email: true,
          status: true,
          valor: true,
          createdAt: true,
          vencimento: true,
        },
      }),
      prisma.faturasContas.findMany({
        where: {
          OR: [
            { criadoEm: { gte: startWindow } },
            { vencimento: { gte: startWindow } },
            { status: { in: ["PENDENTE", "ATRASADO"] } },
          ],
        },
        include: {
          conta: {
            select: {
              id: true,
              nome: true,
              nomeFantasia: true,
              email: true,
              status: true,
              vencimento: true,
            },
          },
        },
        orderBy: {
          vencimento: "asc",
        },
      }),
    ]);

    const totalAssinantes = contas.length;
    const faturamentoMes = faturas
      .filter((item) => item.status === "PAGO" && item.vencimento >= currentMonthStart && item.vencimento <= currentMonthEnd)
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const receberMes = faturas
      .filter((item) => ["PENDENTE", "ATRASADO"].includes(item.status) && item.vencimento >= currentMonthStart && item.vencimento <= currentMonthEnd)
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const pendenteTotal = faturas
      .filter((item) => item.status === "PENDENTE")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const atrasadoTotal = faturas
      .filter((item) => item.status === "ATRASADO")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const totalAReceber = faturas
      .filter((item) => ["PENDENTE", "ATRASADO"].includes(item.status))
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const novosAssinantes = contas.filter((item) => item.createdAt >= currentMonthStart && item.createdAt <= currentMonthEnd).length;

    const monthlyMap: Record<string, { pago: number; novos: number }> = {};
    for (let i = 0; i < 6; i += 1) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = format(monthDate, "MM/yyyy");
      monthlyMap[label] = { pago: 0, novos: 0 };
    }

    contas.forEach((conta) => {
      const label = format(conta.createdAt, "MM/yyyy");
      if (monthlyMap[label]) {
        monthlyMap[label].novos += 1;
      }
    });

    faturas.forEach((fatura) => {
      const label = format(fatura.vencimento, "MM/yyyy");
      if (monthlyMap[label] && fatura.status === "PAGO") {
        monthlyMap[label].pago += Number(fatura.valor || 0);
      }
    });

    const monthlyLabels = Object.keys(monthlyMap);
    const chartNovosAssinantes = {
      labels: monthlyLabels,
      datasets: [
        {
          label: "Novos assinantes",
          data: monthlyLabels.map((label) => monthlyMap[label].novos),
          backgroundColor: "#2563eb",
          borderColor: "#2563eb",
        },
      ],
    };

    const chartFaturamentoMensal = {
      labels: monthlyLabels,
      datasets: [
        {
          label: "Faturamento",
          data: monthlyLabels.map((label) => monthlyMap[label].pago),
          borderColor: "#16a34a",
          backgroundColor: "rgba(22, 163, 74, 0.15)",
          fill: true,
          tension: 0.35,
        },
      ],
    };

    const topMap: Record<number, { nome: string; total: number }> = {};
    faturas
      .filter((item) => item.status === "PAGO")
      .forEach((item) => {
        if (!topMap[item.contaId]) {
          topMap[item.contaId] = {
            nome: item.conta.nomeFantasia || item.conta.nome,
            total: 0,
          };
        }
        topMap[item.contaId].total += Number(item.valor || 0);
      });

    const topInvestidores = Object.values(topMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const chartTopInvestidores = {
      labels: topInvestidores.map((item) => item.nome),
      datasets: [
        {
          label: "Mensalidades pagas",
          data: topInvestidores.map((item) => item.total),
          backgroundColor: "#f59e0b",
          borderColor: "#f59e0b",
        },
      ],
    };

    const inativosMaisTempo = contas
      .filter((item) => item.status !== "ATIVO" || item.vencimento < now)
      .map((item) => ({
        id: item.id,
        nome: item.nomeFantasia || item.nome,
        diasInativo: Math.abs(differenceInCalendarDays(startOfDay(item.vencimento), startOfDay(now))),
        status: item.status,
        email: item.email,
      }))
      .sort((a, b) => b.diasInativo - a.diasInativo)
      .slice(0, 5);

    const chartInativos = {
      labels: inativosMaisTempo.map((item) => item.nome),
      datasets: [
        {
          label: "Dias",
          data: inativosMaisTempo.map((item) => item.diasInativo),
          backgroundColor: "#ef4444",
          borderColor: "#ef4444",
        },
      ],
    };

    const proximosVencimentos = contas
      .filter((item) => {
        const diff = differenceInCalendarDays(startOfDay(item.vencimento), startOfDay(now));
        return diff >= 0 && diff <= 7;
      })
      .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime())
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        nome: item.nomeFantasia || item.nome,
        email: item.email,
        vencimento: item.vencimento,
        diasParaVencer: differenceInCalendarDays(startOfDay(item.vencimento), startOfDay(now)),
        valorPlano: Number(item.valor || 0),
      }));

    return res.json({
      data: {
        kpis: {
          totalAssinantes,
          faturamentoMes,
          receberMes,
          pendenteTotal,
          atrasadoTotal,
          totalAReceber,
          novosAssinantes,
        },
        proximosVencimentos,
        topInvestidores,
        inativosMaisTempo,
        charts: {
          novosAssinantes: chartNovosAssinantes,
          faturamentoMensal: chartFaturamentoMensal,
          topInvestidores: chartTopInvestidores,
          inativosMaisTempo: chartInativos,
        },
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};
