import { Request, Response } from "express";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

dayjs.locale("pt-br");

function getPeriodo(req: Request) {
  const { inicio, fim } = req.query;
  const start = inicio ? dayjs(inicio as string) : dayjs().startOf("month");
  const end = fim ? dayjs(fim as string) : dayjs().endOf("month");
  return { start: start.toDate(), end: end.toDate() };
}

// 🟦 1. Faturamento diário
export async function getFaturamentoDiario(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  // Busca todas as vendas no período
  const vendas = await prisma.vendas.findMany({
    where: {
      data: { gte: start, lte: end },
      status: { in: ["FATURADO", "FINALIZADO"] },
      contaId: customData.contaId,
    },
    select: {
      data: true,
      valor: true,
    },
    orderBy: { data: "asc" },
  });

  // Agrupando manualmente por dia
  const agrupado = vendas.reduce((acc, venda) => {
    const dia = dayjs(venda.data).format("DD/MM");
    acc[dia] = (acc[dia] || 0) + Number(venda.valor);
    return acc;
  }, {} as Record<string, number>);

  const labels = Object.keys(agrupado);
  const data = Object.values(agrupado);

  res.json({
    labels,
    datasets: [
      {
        label: "Faturamento Diário (R$)",
        data,
        borderColor: "#4F46E5",
        backgroundColor: "#6366F1",
      },
    ],
  });
}

// 🟨 2. Faturamento mensal por ano
export async function getFaturamentoMensal(req: Request, res: Response) {
  const { ano } = req.query;
  const anoSelecionado = ano ? Number(ano) : dayjs().year();
  const customData = getCustomRequest(req).customData;
  // Define período de janeiro a dezembro do ano solicitado
  const inicioAno = dayjs(`${anoSelecionado}-01-01`).startOf("day").toDate();
  const fimAno = dayjs(`${anoSelecionado}-12-31`).endOf("day").toDate();

  const vendas = await prisma.vendas.findMany({
    where: {
      data: { gte: inicioAno, lte: fimAno },
      status: { in: ["FATURADO", "FINALIZADO"] },
      contaId: customData.contaId,
    },
    select: {
      data: true,
      valor: true,
    },
    orderBy: { data: "asc" },
  });

  // Agrupar por mês
  const agrupado = vendas.reduce((acc, venda) => {
    const mes = dayjs(venda.data).format("MMMM"); // nome do mês
    acc[mes] = (acc[mes] || 0) + Number(venda.valor);
    return acc;
  }, {} as Record<string, number>);

  const mesesOrdenados = Array.from({ length: 12 }, (_, i) =>
    dayjs().month(i).locale("pt-br").format("MMMM")
  );

  const labels = mesesOrdenados;
  const data = labels.map((m) => agrupado[m] || 0);

  res.json({
    labels,
    datasets: [
      {
        label: `Faturamento Mensal (${anoSelecionado})`,
        data,
        backgroundColor: "#06c93d",
      },
    ],
  });
}

// 🟩 2. Faturamento por método de pagamento
export async function getPorMetodoPagamento(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;

  // Busca todos os pagamentos efetivados no período
  const pagamentos = await prisma.pagamentoVendas.findMany({
    where: {
      data: { gte: start, lte: end },
      status: "EFETIVADO",
      venda: {
        contaId: customData.contaId,
      },
    },
    select: {
      metodo: true,
      valor: true,
    },
  });

  if (pagamentos.length === 0) {
    return res.json({ labels: [], datasets: [] });
  }

  // Agrupamento manual por método de pagamento
  const agrupado = pagamentos.reduce<Record<string, number>>((acc, p) => {
    const metodo = p.metodo;
    const valor = Number(p.valor);
    acc[metodo] = (acc[metodo] || 0) + valor;
    return acc;
  }, {});

  const labels = Object.keys(agrupado);
  const data = Object.values(agrupado);

  return res.json({
    labels,
    datasets: [
      {
        label: "Faturamento por Método",
        data,
        backgroundColor: [
          "#9506c9",
          "#10B981",
          "#c9b606",
          "#EF4444",
          "#3B82F6",
          "#8B5CF6",
          "#F472B6",
          "#14B8A6",
        ],
      },
    ],
  });
}
// 🟨 3. Quantidade de vendas por status
export async function getPorStatusVenda(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  const result = await prisma.vendas.groupBy({
    by: ["status"],
    where: {
      data: { gte: start, lte: end },
      contaId: customData.contaId,
    },
    _count: { _all: true },
  });

  const labels = result.map((r) => r.status);
  const data = result.map((r) => r._count._all);

  res.json({
    labels,
    datasets: [
      {
        label: "Vendas por Status",
        data,
        backgroundColor: [
          "#3B82F6",
          "#06c93d",
          "#F59E0B",
          "#6366F1",
          "#EF4444",
          "#9CA3AF",
        ],
      },
    ],
  });
}

// 🟥 4. Top produtos mais vendidos
export async function getTopProdutos(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  const result = await prisma.itensVendas.groupBy({
    by: ["produtoId"],
    where: {
      venda: {
        data: { gte: start, lte: end },
        status: { in: ["FATURADO", "FINALIZADO"] },
        contaId: customData.contaId,
      },
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: "desc" } },
    take: 10,
  });

  const produtosIds = result.map((r) => r.produtoId);
  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtosIds } },
    select: { id: true, nome: true },
  });

  const labels = result.map((r) => {
    const p = produtos.find((x) => x.id === r.produtoId);
    return p?.nome ?? "Desconhecido";
  });

  const data = result.map((r) => r._sum.quantidade ?? 0);

  res.json({
    labels,
    datasets: [
      {
        label: "Top Produtos Vendidos",
        data,
        backgroundColor: "#0610c9",
      },
    ],
  });
}
