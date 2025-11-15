import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { hasPermission } from "../../helpers/userPermission";

export const graficoByCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
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
export const graficoByContaFinanceira = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const { contaId } = getCustomRequest(req).customData;

  if (!inicio || !fim) {
    return res.status(400).json({ erro: "Informe o período" });
  }

  const contasFinanceiras = await prisma.contasFinanceiro.findMany({
    where: { contaId },
    include: {
      lancamentos: {
        where: {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        },
        include: {
          parcelas: true,
        },
        select: {
          tipo: true,
          parcelas: true,
        },
      },
    },
  });

  const labels: string[] = [];
  const receitas: number[] = [];
  const despesas: number[] = [];

  const sumParcelas = (lanc: any[]) =>
    lanc.reduce(
      (soma, l) =>
        soma +
        l.parcelas.reduce((ps: number, p: any) => ps + Number(p.valor), 0),
      0
    );

  for (const row of contasFinanceiras) {
    const receita = sumParcelas(row.lancamentos.filter((l) => l.tipo === "RECEITA"));
    const despesa = sumParcelas(row.lancamentos.filter((l) => l.tipo === "DESPESA"));

    if (receita > 0 || despesa > 0) {
      labels.push(row.nome);
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
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
      },
      {
        label: "Despesas",
        backgroundColor: "#ef4444",
        data: despesas,
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
      },
    ],
  });
};

export const graficoByStatus = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const { contaId } = getCustomRequest(req).customData;

  if (!inicio || !fim) {
    return res.status(400).json({ erro: "Informe o período" });
  }

  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: {
      contaId,
      dataLancamento: {
        gte: new Date(inicio as string),
        lte: new Date(fim as string),
      },
    },
    include: {
      parcelas: true,
    },
  });

  const sumParcelas = (l: typeof lancamentos) =>
    l.reduce(
      (soma, item) =>
        soma +
        item.parcelas.reduce((ps, p) => ps + Number(p.valor), 0),
      0
    );

  const porStatusTipo = (status: string, tipo: string) =>
    sumParcelas(
      lancamentos.filter((l) => l.status === status && l.tipo === tipo)
    );

  const pagosReceitas = porStatusTipo("PAGO", "RECEITA");
  const pagosDespesas = porStatusTipo("PAGO", "DESPESA");

  const pendentesReceitas = porStatusTipo("PENDENTE", "RECEITA");
  const pendentesDespesas = porStatusTipo("PENDENTE", "DESPESA");

  const parcialReceitas = porStatusTipo("PARCIAL", "RECEITA");
  const parcialDespesas = porStatusTipo("PARCIAL", "DESPESA");

  const atrasadoReceitas = porStatusTipo("ATRASADO", "RECEITA");
  const atrasadoDespesas = porStatusTipo("ATRASADO", "DESPESA");

  return res.json({
    labels: ["Pagos", "Pendentes", "Parcial", "Atrasado"],
    datasets: [
      {
        label: "Receitas",
        backgroundColor: ["#97de26", "#e0d71d", "#8583eb", "#de2672"],
        data: [
          pagosReceitas,
          pendentesReceitas,
          parcialReceitas,
          atrasadoReceitas,
        ],
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
      },
      {
        label: "Despesas",
        backgroundColor: ["#10b981", "#eb8f34", "#4287f5", "#ef4444"],
        data: [
          pagosDespesas,
          pendentesDespesas,
          parcialDespesas,
          atrasadoDespesas,
        ],
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
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
export const graficoSaldoMensal = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;

  if (!await hasPermission(customData, 3)) {
    return res.json({
      labels: [],
      datasets: [
        {
          label: "Saldo",
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          fill: true,
          tension: 0.3,
          data: [],
        },
      ],
    });
  }

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

    const lancamentos = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: customData.contaId,
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
      include: {
        parcelas: true,
      },
    });

    const totalReceita = lancamentos
      .filter((l) => l.tipo === "RECEITA")
      .reduce((acc, l) => {
        const somaParcelas = l.parcelas.reduce(
          (pAcc, p) => pAcc + Number(p.valor),
          0
        );
        return acc + somaParcelas;
      }, 0);

    const totalDespesa = lancamentos
      .filter((l) => l.tipo === "DESPESA")
      .reduce((acc, l) => {
        const somaParcelas = l.parcelas.reduce(
          (pAcc, p) => pAcc + Number(p.valor),
          0
        );
        return acc + somaParcelas;
      }, 0);

    const saldo = new Decimal(totalReceita).minus(totalDespesa);
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

    const lancamentos = await prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId: customData.contaId,
        dataLancamento: { gte: mes.inicio, lte: mes.fim },
      },
      include: {
        parcelas: true,
      },
    });

    const totalReceita = lancamentos
      .filter((l) => l.tipo === "RECEITA")
      .reduce((acc, l) => {
        const somaParcelas = l.parcelas.reduce(
          (pAcc, p) => pAcc + Number(p.valor),
          0
        );
        return acc + somaParcelas;
      }, 0);

    const totalDespesa = lancamentos
      .filter((l) => l.tipo === "DESPESA")
      .reduce((acc, l) => {
        const somaParcelas = l.parcelas.reduce(
          (pAcc, p) => pAcc + Number(p.valor),
          0
        );
        return acc + somaParcelas;
      }, 0);

    receitas.push(totalReceita);
    despesas.push(totalDespesa);
  }

  res.json({
    labels,
    datasets: [
      {
        label: "Receitas",
        backgroundColor: "#10b981",
        data: receitas,
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
        order: 2,
      },
      {
        label: "Despesas",
        backgroundColor: "#ef4444",
        data: despesas.map((d) => -Math.abs(d)),
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
        order: 2,
      },
      {
        label: "Saldo",
        data: receitas.map((r, i) =>
          new Decimal(r).minus(new Decimal(despesas[i])).toNumber()
        ),
        type: "line",
        borderWidth: 2,
        borderRadius: 5,
        borderSkipped: false,
        borderColor: "#3b82f6",
        tension: 0.3,
        pointRadius: 0,
        fill: true,
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        order: 1,
      },
    ],
  });
};
