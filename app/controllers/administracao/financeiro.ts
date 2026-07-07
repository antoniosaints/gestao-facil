import { Request, Response } from "express";
import { startOfMonth, subMonths, format } from "date-fns";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { assertSuperAdmin } from "./assinantes";

export const getFinanceiroPainelAdmin = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const isSuperAdmin = await assertSuperAdmin(customData.userId);
    if (!isSuperAdmin) {
      return res.status(403).json({
        message: "Usuário não tem permissão para visualizar esses dados.",
      });
    }

    const now = new Date();
    const inicioSerie = startOfMonth(subMonths(now, 11));

    const [contasAtivas, totalContas, mrrAgg, pendentesAgg, atrasadasAgg, pagasMesAgg, faturasSerie, topPendentes] =
      await Promise.all([
        prisma.contas.count({ where: { status: "ATIVO" } }),
        prisma.contas.count(),
        prisma.contas.aggregate({
          where: { status: "ATIVO" },
          _sum: { valor: true },
        }),
        prisma.faturasContas.aggregate({
          where: { status: "PENDENTE" },
          _sum: { valor: true },
          _count: true,
        }),
        prisma.faturasContas.aggregate({
          where: {
            OR: [
              { status: "ATRASADO" },
              { status: "PENDENTE", vencimento: { lt: now } },
            ],
          },
          _sum: { valor: true },
          _count: true,
        }),
        prisma.faturasContas.aggregate({
          where: {
            status: "PAGO",
            criadoEm: { gte: startOfMonth(now) },
          },
          _sum: { valor: true },
          _count: true,
        }),
        prisma.faturasContas.findMany({
          where: {
            criadoEm: { gte: inicioSerie },
          },
          select: {
            valor: true,
            status: true,
            criadoEm: true,
          },
        }),
        prisma.faturasContas.groupBy({
          by: ["contaId"],
          where: {
            OR: [
              { status: "PENDENTE" },
              { status: "ATRASADO" },
            ],
          },
          _sum: { valor: true },
          _count: true,
          orderBy: {
            _sum: { valor: "desc" },
          },
          take: 10,
        }),
      ]);

    // Serie mensal (12 meses): recebido x gerado
    const meses: Array<{ mes: string; recebido: number; gerado: number }> = [];
    for (let i = 11; i >= 0; i--) {
      meses.push({ mes: format(subMonths(now, i), "MM/yyyy"), recebido: 0, gerado: 0 });
    }
    const mesIndex = new Map(meses.map((item, index) => [item.mes, index]));
    faturasSerie.forEach((fatura) => {
      const key = format(fatura.criadoEm, "MM/yyyy");
      const index = mesIndex.get(key);
      if (index === undefined) return;
      meses[index].gerado += Number(fatura.valor || 0);
      if (fatura.status === "PAGO") {
        meses[index].recebido += Number(fatura.valor || 0);
      }
    });

    const statusDistribuicao = await prisma.faturasContas.groupBy({
      by: ["status"],
      _count: true,
      _sum: { valor: true },
    });

    const contasPendentes = await prisma.contas.findMany({
      where: {
        id: { in: topPendentes.map((item) => item.contaId) },
      },
      select: {
        id: true,
        nome: true,
        nomeFantasia: true,
        email: true,
        status: true,
      },
    });
    const contaMap = new Map(contasPendentes.map((conta) => [conta.id, conta]));

    return ResponseHandler(res, "Painel financeiro carregado", {
      resumo: {
        mrrEstimado: Number(mrrAgg._sum?.valor || 0),
        contasAtivas,
        totalContas,
        recebidoMes: Number(pagasMesAgg._sum?.valor || 0),
        faturasPagasMes: pagasMesAgg._count || 0,
        pendenteTotal: Number(pendentesAgg._sum?.valor || 0),
        faturasPendentes: pendentesAgg._count || 0,
        atrasadoTotal: Number(atrasadasAgg._sum?.valor || 0),
        faturasAtrasadas: atrasadasAgg._count || 0,
      },
      receitaMensal: meses,
      statusDistribuicao: statusDistribuicao.map((item) => ({
        status: item.status,
        quantidade: item._count,
        valor: Number(item._sum?.valor || 0),
      })),
      topInadimplentes: topPendentes.map((item) => ({
        contaId: item.contaId,
        nome: contaMap.get(item.contaId)?.nomeFantasia || contaMap.get(item.contaId)?.nome || `Conta ${item.contaId}`,
        email: contaMap.get(item.contaId)?.email || null,
        status: contaMap.get(item.contaId)?.status || null,
        faturas: item._count,
        valor: Number(item._sum?.valor || 0),
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};
