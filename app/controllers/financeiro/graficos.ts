import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const graficoByCategoria = async (req: Request, res: Response): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  if (!inicio || !fim) {
    return res.status(400).json({ erro: "Informe o período" });
  }

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId: customData.contaId,
    },
    include: {
      lancamentos: {
        where: {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        },
        select: {
          tipo: true,
          valorTotal: true,
        },
      },
    },
  });

  const labels: string[] = [];
  const receitas: number[] = [];
  const despesas: number[] = [];

  for (const cat of categorias) {
    const receita = cat.lancamentos
      .filter((l) => l.tipo === "RECEITA")
      .reduce((s, l) => s + Number(l.valorTotal), 0);

    const despesa = cat.lancamentos
      .filter((l) => l.tipo === "DESPESA")
      .reduce((s, l) => s + Number(l.valorTotal), 0);

    if (receita > 0 || despesa > 0) {
      labels.push(cat.nome);
      receitas.push(receita);
      despesas.push(despesa);
    }
  }

  return res.json({
    labels,
    datasets: [
      {
        label: "Receitas",
        backgroundColor: "#10b981",
        data: receitas,
      },
      {
        label: "Despesas",
        backgroundColor: "#ef4444",
        data: despesas,
      },
    ],
  });
};

export const graficoDespesasPorCategoria = async (
  req: Request,
  res: Response
) => {
  const customData = getCustomRequest(req).customData;
  const now = new Date();
  const inicio = startOfMonth(now);
  const fim = endOfMonth(now);

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId: customData.contaId,
    },
    include: {
      lancamentos: {
        where: {
          tipo: "DESPESA",
          dataLancamento: { gte: inicio, lte: fim },
        },
        select: { valorTotal: true },
      },
    },
  });

  const labels: string[] = [];
  const valores: number[] = [];

  for (const cat of categorias) {
    const total = cat.lancamentos.reduce((s, l) => s + Number(l.valorTotal), 0);
    if (total > 0) {
      labels.push(cat.nome);
      valores.push(total);
    }
  }

  res.json({
    labels,
    datasets: [
      {
        label: "Despesas por categoria",
        backgroundColor: [
          "#f87171",
          "#fb923c",
          "#facc15",
          "#4ade80",
          "#60a5fa",
          "#a78bfa",
          "#f472b6",
        ],
        data: valores,
      },
    ],
  });
};
export const graficoSaldoMensal = async (req: Request, res: Response) => {
  const customData = getCustomRequest(req).customData;
  const meses = Array.from({ length: 6 }).map((_, i) => {
    const ref = subMonths(new Date(), 5 - i);
    return {
      label: ref.toLocaleDateString("pt-BR", {
        month: "short",
        year: "numeric",
      }),
      inicio: startOfMonth(ref),
      fim: endOfMonth(ref),
    };
  });

  const labels: string[] = [];
  const saldos: number[] = [];

  for (const mes of meses) {
    labels.push(mes.label);

    const receita = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        tipo: "RECEITA",
        contaId: customData.contaId,
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
    });

    const despesa = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        tipo: "DESPESA",
        contaId: customData.contaId,
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
    });

    const saldo = new Decimal(receita._sum.valorTotal || 0).minus(
      despesa._sum.valorTotal || 0
    );
    saldos.push(Number(saldo));
  }

  res.json({
    labels,
    datasets: [
      {
        label: "Saldo",
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        fill: true,
        tension: 0.3,
        data: saldos,
      },
    ],
  });
};
export const graficoReceitaDespesaMensal = async (
  req: Request,
  res: Response
) => {
  const customData = getCustomRequest(req).customData;
  const meses = Array.from({ length: 6 }).map((_, i) => {
    const ref = subMonths(new Date(), 5 - i);
    return {
      label: ref.toLocaleDateString("pt-BR", {
        month: "short",
        year: "numeric",
      }),
      inicio: startOfMonth(ref),
      fim: endOfMonth(ref),
    };
  });

  const labels: string[] = [];
  const receitas: number[] = [];
  const despesas: number[] = [];

  for (const mes of meses) {
    labels.push(mes.label);

    const receita = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "RECEITA",
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
    });

    const despesa = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "DESPESA",
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
    });

    receitas.push(Number(receita._sum.valorTotal || 0));
    despesas.push(Number(despesa._sum.valorTotal || 0));
  }

  res.json({
    labels,
    datasets: [
      {
        label: "Receitas",
        backgroundColor: "#10b981",
        data: receitas,
      },
      {
        label: "Despesas",
        backgroundColor: "#ef4444",
        data: despesas,
      },
    ],
  });
};
