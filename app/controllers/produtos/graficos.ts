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

function getContaId(req: Request) {
  return Number(getCustomRequest(req).customData.contaId);
}

function getLabelsPeriodo(start: Date, end: Date) {
  const labels: string[] = [];
  let cursor = dayjs(start).startOf("month");
  const limite = dayjs(end).startOf("month");

  while (cursor.isBefore(limite) || cursor.isSame(limite, "month")) {
    labels.push(cursor.format("MM/YYYY"));
    cursor = cursor.add(1, "month");
  }

  return labels;
}

function getNomeProduto(produto?: {
  nome?: string | null;
  nomeVariante?: string | null;
}) {
  if (!produto?.nome) return "Desconhecido";
  if (!produto.nomeVariante || produto.nomeVariante === "Padrão") return produto.nome;
  return `${produto.nome} / ${produto.nomeVariante}`;
}

function getPieColors(total: number) {
  const palette = [
    "#3B82F6",
    "#10B981",
    "#F59E0B",
    "#8B5CF6",
    "#EF4444",
    "#06B6D4",
    "#F97316",
    "#22C55E",
    "#6366F1",
    "#EAB308",
  ];

  return Array.from({ length: total }, (_, index) => palette[index % palette.length]);
}

// 1. Reposição mensal + custo
export async function getReposicaoMensal(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const contaId = getContaId(req);
  const movimentacoes = await prisma.movimentacoesEstoque.findMany({
    where: {
      data: { gte: start, lte: end },
      contaId,
      tipo: "ENTRADA",
      status: "CONCLUIDO",
    },
    select: { data: true, quantidade: true, custo: true },
  });

  const agrupado = movimentacoes.reduce((acc, mov) => {
    const mes = dayjs(mov.data).format("MM/YYYY");
    acc[mes] = acc[mes] || { qtd: 0, custo: 0 };
    acc[mes].qtd += mov.quantidade;
    acc[mes].custo += Number(mov.custo) * mov.quantidade;
    return acc;
  }, {} as Record<string, { qtd: number; custo: number }>);

  const labels = getLabelsPeriodo(start, end);
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
  const contaId = getContaId(req);
  const result = await prisma.movimentacoesEstoque.groupBy({
    by: ["produtoId"],
    where: {
      tipo: "ENTRADA",
      status: "CONCLUIDO",
      data: { gte: start, lte: end },
      contaId,
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: "desc" } },
    take: 10,
  });

  const produtos = await prisma.produto.findMany({
    where: {
      id: { in: result.map((r) => r.produtoId) },
      contaId,
    },
    select: { id: true, nome: true, nomeVariante: true },
  });

  const labels = result.map(
    (r) =>
      getNomeProduto(produtos.find((p) => p.id === r.produtoId)) ??
      "Desconhecido"
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
  const contaId = getContaId(req);
  const result = await prisma.itensVendas.groupBy({
    by: ["produtoId"],
    where: {
      produtoId: { not: null },
      venda: {
        data: { gte: start, lte: end },
        contaId,
      },
    },
    _sum: { quantidade: true },
    orderBy: { _sum: { quantidade: "asc" } },
    take: 10,
  });

  const produtosIds = result.flatMap((item) =>
    typeof item.produtoId === "number" ? [item.produtoId] : []
  );
  const produtos = produtosIds.length
    ? await prisma.produto.findMany({
        where: {
          id: { in: produtosIds },
          contaId,
        },
        select: { id: true, nome: true, nomeVariante: true },
      })
    : [];

  const labels = result.map(
    (r) =>
      getNomeProduto(produtos.find((p) => p.id === r.produtoId)) ??
      "Desconhecido"
  );
  const data = result.map((r) => r._sum.quantidade || 0);

  res.json({
    labels,
    datasets: [
      {
        label: "Menor saída",
        data,
        backgroundColor: "#EF4444",
      },
    ],
  });
}

// 4. Lucro realizado por produto no período
export async function getLucroMedioProdutos(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const contaId = getContaId(req);
  const itensVendidos = await prisma.itensVendas.findMany({
    where: {
      produtoId: { not: null },
      venda: {
        contaId,
        data: { gte: start, lte: end },
        status: "FATURADO",
      },
    },
    select: {
      produtoId: true,
      quantidade: true,
      valor: true,
      produto: {
        select: {
          nome: true,
          nomeVariante: true,
          precoCompra: true,
        },
      },
    },
  });

  const agrupado = itensVendidos.reduce((acc, item) => {
    if (!item.produtoId) return acc;
    const lucro = new Decimal(item.valor)
      .minus(item.produto?.precoCompra || 0)
      .times(item.quantidade)
      .toNumber();

    if (!acc[item.produtoId]) {
      acc[item.produtoId] = {
        nome: getNomeProduto(item.produto),
        lucro: 0,
      };
    }

    acc[item.produtoId].lucro += lucro;
    return acc;
  }, {} as Record<number, { nome: string; lucro: number }>);

  const ranking = Object.values(agrupado)
    .sort((a, b) => b.lucro - a.lucro)
    .slice(0, 10);

  res.json({
    labels: ranking.map((item) => item.nome),
    datasets: [
      {
        label: "Lucro realizado (R$)",
        data: ranking.map((item) => Number(item.lucro.toFixed(2))),
        backgroundColor: "#F59E0B",
      },
    ],
  });
}

// 5. Ticket médio de vendas por mês no período
export async function getTicketMedio(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const contaId = getContaId(req);
  const vendas = await prisma.vendas.findMany({
    where: {
      data: { gte: start, lte: end },
      contaId,
      status: "FATURADO",
    },
    select: { valor: true, data: true },
  });

  const agrupado = vendas.reduce((acc, v) => {
    const mes = dayjs(v.data).format("MM/YYYY");
    acc[mes] = acc[mes] || { total: 0, count: 0 };
    acc[mes].total += Number(v.valor);
    acc[mes].count++;
    return acc;
  }, {} as Record<string, { total: number; count: number }>);

  const labels = getLabelsPeriodo(start, end);
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
        borderColor: "#10B981",
        fill: false,
        tension: 0.35,
      },
    ],
  });
}

// 6. Giro de estoque no período
export async function getGiroEstoque(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const contaId = getContaId(req);
  const produtos = await prisma.produto.findMany({
    where: {
      contaId,
      controlaEstoque: true,
    },
    select: { nome: true, nomeVariante: true, estoque: true, id: true },
  });

  const vendas = await prisma.itensVendas.groupBy({
    where: {
      produtoId: { not: null },
      venda: {
        contaId,
        data: { gte: start, lte: end },
        status: "FATURADO",
      },
    },
    by: ["produtoId"],
    _sum: { quantidade: true },
  });

  const ranking = produtos
    .map((produto) => {
      const venda = vendas.find((item) => item.produtoId === produto.id);
      const qtdVendida = venda?._sum.quantidade || 0;
      const giro = produto.estoque > 0 ? qtdVendida / produto.estoque : qtdVendida;

      return {
        nome: getNomeProduto(produto),
        giro,
      };
    })
    .sort((a, b) => b.giro - a.giro)
    .slice(0, 10);

  res.json({
    labels: ranking.map((item) => item.nome),
    datasets: [
      {
        label: "Giro de estoque",
        data: ranking.map((item) => Number(item.giro.toFixed(2))),
        backgroundColor: "#3B82F6",
      },
    ],
  });
}

// 7. Margem média por produto
export async function getMargemMedia(req: Request, res: Response) {
  const contaId = getContaId(req);
  const produtos = await prisma.produto.findMany({
    where: {
      contaId,
      preco: { gt: 0 },
    },
    select: {
      nome: true,
      nomeVariante: true,
      preco: true,
      precoCompra: true,
      custoMedioProducao: true,
    },
  });

  const ranking = produtos
    .map((produto) => {
      const custoBase = produto.custoMedioProducao ?? produto.precoCompra ?? 0;
      const venda = Number(produto.preco);
      const custo = Number(custoBase);
      const margem = venda > 0 ? ((venda - custo) / venda) * 100 : 0;

      return {
        nome: getNomeProduto(produto),
        margem,
      };
    })
    .sort((a, b) => b.margem - a.margem)
    .slice(0, 10);

  res.json({
    labels: ranking.map((item) => item.nome),
    datasets: [
      {
        label: "Margem de contribuição (%)",
        data: ranking.map((item) => Number(item.margem.toFixed(2))),
        backgroundColor: "#8B5CF6",
      },
    ],
  });
}

// 8. Fluxo mensal de estoque
export async function getFluxoEstoqueMensal(req: Request, res: Response) {
  const { start, end } = getPeriodo(req);
  const contaId = getContaId(req);
  const movimentacoes = await prisma.movimentacoesEstoque.findMany({
    where: {
      contaId,
      status: "CONCLUIDO",
      data: { gte: start, lte: end },
    },
    select: {
      data: true,
      quantidade: true,
      tipo: true,
    },
  });

  const agrupado = movimentacoes.reduce((acc, mov) => {
    const mes = dayjs(mov.data).format("MM/YYYY");
    acc[mes] = acc[mes] || { entrada: 0, saida: 0 };
    if (mov.tipo === "ENTRADA") acc[mes].entrada += mov.quantidade;
    if (mov.tipo === "SAIDA") acc[mes].saida += mov.quantidade;
    return acc;
  }, {} as Record<string, { entrada: number; saida: number }>);

  const labels = getLabelsPeriodo(start, end);

  res.json({
    labels,
    datasets: [
      {
        label: "Entradas",
        data: labels.map((label) => agrupado[label]?.entrada || 0),
        borderColor: "#10B981",
        backgroundColor: "rgba(16, 185, 129, 0.18)",
        fill: true,
        tension: 0.35,
      },
      {
        label: "Saídas",
        data: labels.map((label) => agrupado[label]?.saida || 0),
        borderColor: "#EF4444",
        backgroundColor: "rgba(239, 68, 68, 0.18)",
        fill: true,
        tension: 0.35,
      },
    ],
  });
}

// 9. Distribuição do catálogo por categoria
export async function getDistribuicaoCategorias(req: Request, res: Response) {
  const contaId = getContaId(req);
  const produtosBase = await prisma.produtoBase.findMany({
    where: { contaId },
    select: {
      id: true,
      Categoria: {
        select: {
          nome: true,
        },
      },
    },
  });

  const agrupado = produtosBase.reduce((acc, produto) => {
    const categoria = produto.Categoria?.nome || "Sem categoria";
    acc[categoria] = (acc[categoria] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const ranking = Object.entries(agrupado).sort((a, b) => b[1] - a[1]);
  const labels = ranking.map(([label]) => label);
  const data = ranking.map(([, value]) => value);

  res.json({
    labels,
    datasets: [
      {
        label: "Produtos por categoria",
        data,
        backgroundColor: getPieColors(labels.length),
      },
    ],
  });
}

// 10. Saúde do estoque por variante
export async function getSaudeEstoqueProdutos(req: Request, res: Response) {
  const contaId = getContaId(req);
  const produtos = await prisma.produto.findMany({
    where: { contaId },
    select: {
      estoque: true,
      minimo: true,
      controlaEstoque: true,
    },
  });

  const resumo = {
    saudavel: 0,
    baixo: 0,
    semEstoque: 0,
    semControle: 0,
  };

  for (const produto of produtos) {
    if (!produto.controlaEstoque) {
      resumo.semControle++;
      continue;
    }

    if (produto.estoque <= 0) {
      resumo.semEstoque++;
      continue;
    }

    if (produto.estoque < produto.minimo) {
      resumo.baixo++;
      continue;
    }

    resumo.saudavel++;
  }

  const labels = [
    "Saudável",
    "Estoque baixo",
    "Sem estoque",
    "Sem controle",
  ];
  const data = [
    resumo.saudavel,
    resumo.baixo,
    resumo.semEstoque,
    resumo.semControle,
  ];

  res.json({
    labels,
    datasets: [
      {
        label: "Saúde do estoque",
        data,
        backgroundColor: ["#10B981", "#F59E0B", "#EF4444", "#94A3B8"],
      },
    ],
  });
}

export async function getResumoGeralProdutos(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const { inicio, fim } = req.query;
    const contaId = getContaId(req);

    const startDate = inicio
      ? new Date(String(inicio))
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const endDate = fim ? new Date(String(fim)) : new Date();

    const [
      vendas,
      reposicoes,
      itensVendidos,
      produtos,
      totalProdutosBase,
      totalVariantes,
      totalCategorias,
    ] = await Promise.all([
      prisma.vendas.findMany({
        where: {
          contaId,
          data: { gte: startDate, lte: endDate },
          status: "FATURADO",
        },
        select: { valor: true },
      }),
      prisma.movimentacoesEstoque.findMany({
        where: {
          contaId,
          data: { gte: startDate, lte: endDate },
          tipo: "ENTRADA",
          status: "CONCLUIDO",
        },
        select: { custo: true, quantidade: true },
      }),
      prisma.itensVendas.findMany({
        where: {
          venda: {
            contaId,
            data: { gte: startDate, lte: endDate },
            status: "FATURADO",
          },
        },
        select: {
          valor: true,
          quantidade: true,
          produto: {
            select: {
              precoCompra: true,
              custoMedioProducao: true,
            },
          },
        },
      }),
      prisma.produto.findMany({
        where: { contaId },
        select: {
          estoque: true,
          minimo: true,
          controlaEstoque: true,
          mostrarNoPdv: true,
          materiaPrima: true,
          precoCompra: true,
          custoMedioProducao: true,
        },
      }),
      prisma.produtoBase.count({
        where: { contaId },
      }),
      prisma.produto.count({
        where: { contaId },
      }),
      prisma.produtoCategoria.count({
        where: { contaId },
      }),
    ]);

    const totalVendas = vendas.reduce(
      (acc, venda) => acc.plus(venda.valor),
      new Decimal(0)
    );
    const ticketMedioGeral =
      vendas.length > 0 ? totalVendas.div(vendas.length) : new Decimal(0);

    const custoReposicoes = reposicoes.reduce(
      (acc, reposicao) =>
        acc.plus(new Decimal(reposicao.custo).times(reposicao.quantidade)),
      new Decimal(0)
    );

    const lucroMensal = itensVendidos.reduce((acc, item) => {
      const custoUnitario = item.produto?.custoMedioProducao ?? item.produto?.precoCompra ?? 0;
      const custo = new Decimal(custoUnitario).times(item.quantidade);
      const totalVenda = new Decimal(item.valor).times(item.quantidade);
      return acc.plus(totalVenda.minus(custo));
    }, new Decimal(0));

    const produtosEstoqueBaixo = produtos.filter(
      (produto) =>
        Boolean(produto.controlaEstoque) &&
        produto.estoque > 0 &&
        produto.estoque < produto.minimo
    ).length;

    const produtosSemEstoque = produtos.filter(
      (produto) => Boolean(produto.controlaEstoque) && produto.estoque <= 0
    ).length;

    const produtosNoPdv = produtos.filter(
      (produto) =>
        (produto.mostrarNoPdv === true || produto.mostrarNoPdv === null) &&
        (produto.materiaPrima === false || produto.materiaPrima === null)
    ).length;

    const materiasPrimas = produtos.filter(
      (produto) => produto.materiaPrima === true
    ).length;

    const controlaEstoque = produtos.filter(
      (produto) => produto.controlaEstoque === true
    ).length;

    const valorEstoque = produtos.reduce((acc, produto) => {
      const custoUnitario = produto.custoMedioProducao ?? produto.precoCompra ?? 0;
      return acc.plus(new Decimal(custoUnitario).times(produto.estoque));
    }, new Decimal(0));

    return res.json({
      ticketMedioGeral: ticketMedioGeral.toFixed(2),
      custoReposicoes: custoReposicoes.toFixed(2),
      lucroMensal: lucroMensal.toFixed(2),
      estoqueBaixo: produtosEstoqueBaixo,
      produtosSemEstoque,
      totalProdutosBase,
      totalVariantes,
      totalCategorias,
      produtosNoPdv,
      materiasPrimas,
      controlaEstoque,
      valorEstoque: valorEstoque.toFixed(2),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao gerar resumo geral de produtos" });
  }
}
