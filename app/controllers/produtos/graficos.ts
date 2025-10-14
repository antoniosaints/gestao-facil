import { Request, Response } from "express";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import Decimal from "decimal.js";

dayjs.locale("pt-br");

function getPeriodo(req: Request) {
  const { inicio, fim } = req.query;
  const start = inicio ? dayjs(inicio as string) : dayjs().startOf("month");
  const end = fim ? dayjs(fim as string) : dayjs().endOf("month");
  return { start: start.toDate(), end: end.toDate() };
}

// 1. Reposição mensal + custo
export async function getReposicaoMensal(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  const movimentacoes = await prisma.movimentacoesEstoque.findMany({
    where: {
      data: { gte: start, lte: end },
      contaId: customData.contaId,
      tipo: "ENTRADA",
      status: "CONCLUIDO",
    },
    select: { data: true, quantidade: true, custo: true },
  });

  const agrupado = movimentacoes.reduce((acc, mov) => {
    const mes = dayjs(mov.data).format("MMMM");
    acc[mes] = acc[mes] || { qtd: 0, custo: 0 };
    acc[mes].qtd += mov.quantidade;
    acc[mes].custo += Number(mov.custo) * mov.quantidade;
    return acc;
  }, {} as Record<string, { qtd: number; custo: number }>);

  const mesesOrdenados = Array.from({ length: 12 }, (_, i) =>
    dayjs().month(i).locale("pt-br").format("MMMM")
  );

  const labels = mesesOrdenados;
  const qtdData = labels.map((m) => agrupado[m]?.qtd || 0);
  const custoData = labels.map((m) => agrupado[m]?.custo || 0);

  res.json({
    labels,
    datasets: [
      {
        label: "Reposições (unidades)",
        data: qtdData,
        backgroundColor: "#3B82F6",
        yAxisID: "y",
      },
      {
        label: "Custo total de reposição (R$)",
        data: custoData,
        borderColor: "#10B981",
        backgroundColor: "#10B981",
        type: "line",
        yAxisID: "y",
      },
    ],
  });
}

// 2. Produtos mais repostos
export async function getProdutosMaisRepostos(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  const result = await prisma.movimentacoesEstoque.groupBy({
    by: ["produtoId"],
    where: {
      tipo: "ENTRADA",
      status: "CONCLUIDO",
      data: { gte: start, lte: end },
      contaId: customData.contaId,
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: "desc" } },
    take: 10,
  });

  const produtos = await prisma.produto.findMany({
    where: {
      id: { in: result.map((r) => r.produtoId) },
      contaId: customData.contaId,
    },
    select: { id: true, nome: true },
  });

  const labels = result.map(
    (r) => produtos.find((p) => p.id === r.produtoId)?.nome ?? "Desconhecido"
  );
  const data = result.map((r) => r._sum.quantidade || 0);

  res.json({
    labels,
    datasets: [
      {
        label: "Mais Repostos",
        data,
        backgroundColor: "#6366F1",
      },
    ],
  });
}

// 3. Produtos com menor saída
export async function getProdutosMenosSaida(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const customData = getCustomRequest(req).customData;
  const result = await prisma.itensVendas.groupBy({
    by: ["produtoId"],
    where: {
      venda: { data: { gte: start, lte: end }, contaId: customData.contaId },
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: "asc" } },
    take: 10,
  });

  const produtos = await prisma.produto.findMany({
    where: {
      id: { in: result.map((r) => r.produtoId) },
      contaId: customData.contaId,
    },
    select: { id: true, nome: true },
  });

  const labels = result.map(
    (r) => produtos.find((p) => p.id === r.produtoId)?.nome ?? "Desconhecido"
  );
  const data = result.map((r) => r._sum.quantidade || 0);

  res.json({
    labels,
    datasets: [
      {
        label: "Menos Saída",
        data,
        backgroundColor: "#EF4444",
      },
    ],
  });
}

// 4. Lucro médio por produto
export async function getLucroMedioProdutos(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const produtos = await prisma.produto.findMany({
    where: { contaId: customData.contaId },
    select: { nome: true, preco: true, precoCompra: true },
    take: 15,
    orderBy: { id: "asc" },
  });

  const labels = produtos.map((p) => p.nome);
  const data = produtos.map(
    (p) => Number(p.preco) - Number(p.precoCompra || 0)
  );

  res.json({
    labels,
    datasets: [
      {
        label: "Lucro Médio por Produto (R$)",
        data,
        backgroundColor: "#F59E0B",
      },
    ],
  });
}

// 5. Ticket médio de vendas
export async function getTicketMedio(req: Request, res: Response) {
  const { ano } = req.query;
  const anoSelecionado = ano ? Number(ano) : dayjs().year();
  const start = dayjs(`${anoSelecionado}-01-01`).startOf("day").toDate();
  const end = dayjs(`${anoSelecionado}-12-31`).endOf("day").toDate();
  const customData = getCustomRequest(req).customData;
  const vendas = await prisma.vendas.findMany({
    where: { data: { gte: start, lte: end }, contaId: customData.contaId },
    select: { valor: true, data: true },
  });

  const agrupado = vendas.reduce((acc, v) => {
    const mes = dayjs(v.data).format("MMMM");
    acc[mes] = acc[mes] || { total: 0, count: 0 };
    acc[mes].total += Number(v.valor);
    acc[mes].count++;
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  const meses = Array.from({ length: 12 }, (_, i) =>
    dayjs().month(i).format("MMMM")
  );

  const labels = meses;
  const data = labels.map((m) =>
    agrupado[m] ? agrupado[m].total / agrupado[m].count : 0
  );

  res.json({
    labels,
    datasets: [
      {
        label: "Ticket Médio (R$)",
        data,
        backgroundColor: "#10B981",
      },
    ],
  });
}

// 6. Giro de estoque
export async function getGiroEstoque(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const produtos = await prisma.produto.findMany({
    where: { contaId: customData.contaId },
    select: { nome: true, estoque: true, id: true },
    take: 15,
  });

  const vendas = await prisma.itensVendas.groupBy({
    where: { venda: { contaId: customData.contaId } },
    by: ["produtoId"],
    _sum: { quantidade: true },
  });

  const labels = produtos.map((p) => p.nome);
  const data = produtos.map((p) => {
    const v = vendas.find((v) => v.produtoId === p.id);
    const qtdVendida = v?._sum.quantidade || 0;
    return p.estoque > 0 ? qtdVendida / p.estoque : 0;
  });

  res.json({
    labels,
    datasets: [
      {
        label: "Giro de Estoque",
        data,
        backgroundColor: "#3B82F6",
      },
    ],
  });
}

// 7. Margem média
export async function getMargemMedia(req: Request, res: Response) {
  const customData = getCustomRequest(req).customData;
  const produtos = await prisma.produto.findMany({
    where: { contaId: customData.contaId },
    select: { nome: true, preco: true, precoCompra: true },
    take: 15,
  });

  const labels = produtos.map((p) => p.nome);
  const data = produtos.map((p) => {
    const custo = Number(p.precoCompra || 0);
    const venda = Number(p.preco);
    return venda > 0 ? ((venda - custo) / venda) * 100 : 0;
  });

  res.json({
    labels,
    datasets: [
      {
        label: "Margem de Contribuição (%)",
        data,
        backgroundColor: "#8B5CF6",
      },
    ],
  });
}

export async function getResumoGeralProdutos(req: Request, res: Response): Promise<any> {
  try {
    const { inicio, fim } = req.query;
    const customData = getCustomRequest(req).customData;
    const { contaId } = customData;

    // Datas padrão (mês atual)
    const startDate = inicio ? new Date(String(inicio)) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = fim ? new Date(String(fim)) : new Date();

    // 📊 Ticket médio geral (total vendido / quantidade de vendas)
    const vendas = await prisma.vendas.findMany({
      where: {
        contaId: Number(contaId),
        data: { gte: startDate, lte: endDate },
        status: "FATURADO",
      },
      select: { valor: true },
    });

    const totalVendas = vendas.reduce((acc, v) => acc.plus(v.valor), new Decimal(0));
    const ticketMedioGeral = vendas.length > 0 ? totalVendas.div(vendas.length) : new Decimal(0);

    // 📦 Custo com reposições (entradas no estoque)
    const reposicoes = await prisma.movimentacoesEstoque.findMany({
      where: {
        contaId: Number(contaId),
        data: { gte: startDate, lte: endDate },
        tipo: "ENTRADA",
        status: "CONCLUIDO",
      },
      select: { custo: true, quantidade: true },
    });

    const custoReposicoes = reposicoes.reduce(
      (acc, r) => acc.plus(new Decimal(r.custo).times(r.quantidade)),
      new Decimal(0)
    );

    // 💰 Lucro mensal (valor venda - custo unitário * quantidade)
    const itensVendidos = await prisma.itensVendas.findMany({
      where: {
        venda: {
          contaId: Number(contaId),
          data: { gte: startDate, lte: endDate },
          status: "FATURADO",
        },
      },
      select: {
        valor: true,
        quantidade: true,
        produto: { select: { precoCompra: true } },
      },
    });

    const lucroMensal = itensVendidos.reduce((acc, item) => {
      const custo = new Decimal(item.produto.precoCompra || 0).times(item.quantidade);
      const totalVenda = new Decimal(item.valor).times(item.quantidade);
      return acc.plus(totalVenda.minus(custo));
    }, new Decimal(0));

    // ⚠️ ajuste correto para comparação de mínimo
    const produtos = await prisma.produto.findMany({
      where: { contaId: Number(contaId) },
      select: { estoque: true, minimo: true },
    });

    const produtosEstoqueBaixo = produtos.filter(p => p.estoque < p.minimo).length;

    return res.json({
      ticketMedioGeral: ticketMedioGeral.toFixed(2),
      custoReposicoes: custoReposicoes.toFixed(2),
      lucroMensal: lucroMensal.toFixed(2),
      estoqueBaixo: produtosEstoqueBaixo,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao gerar resumo geral de produtos" });
  }
}