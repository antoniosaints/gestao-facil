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
      faturado: true,
    },
    select: { valor: true, data: true },
  });

  const agrupado = vendas.reduce((acc, v) => {
    const mes = dayjs(v.data).format("MM/YYYY");
    acc[mes] = acc[mes] || { total: new Decimal(0), count: 0 };
    acc[mes].total = acc[mes].total.plus(new Decimal(v.valor || 0));
    acc[mes].count++;
    return acc;
  }, {} as Record<string, { total: Decimal; count: number }>);

  const labels = getLabelsPeriodo(start, end);
  const data = labels.map((m) =>
    agrupado[m] ? agrupado[m].total.div(agrupado[m].count).toNumber() : 0,
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

    if (produto.estoque <= produto.minimo) {
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
        produto.estoque <= produto.minimo
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

/**
 * Painel de produtos consolidado: KPIs com comparação ao período anterior,
 * curva de receita, distribuição por categoria, saúde do estoque e rankings
 * (receita, lucro, mais repostos, estoque crítico) — tudo em uma requisição.
 */
export async function getPainelProdutos(req: Request, res: Response): Promise<any> {
  try {
    const contaId = getContaId(req);
    const { start, end } = getPeriodo(req);
    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const [
      vendas,
      vendasAnterior,
      itens,
      itensAnterior,
      reposicoes,
      produtos,
      produtosBase,
      totalProdutosBase,
      totalVariantes,
      totalCategorias,
    ] = await Promise.all([
      prisma.vendas.findMany({
        where: { contaId, status: "FATURADO", data: { gte: start, lte: end } },
        select: { valor: true, data: true },
      }),
      prisma.vendas.findMany({
        where: { contaId, status: "FATURADO", data: { gte: prevStart, lte: prevEnd } },
        select: { valor: true },
      }),
      prisma.itensVendas.findMany({
        where: { venda: { contaId, status: "FATURADO", data: { gte: start, lte: end } } },
        select: {
          produtoId: true,
          itemName: true,
          quantidade: true,
          valor: true,
          produto: {
            select: { nome: true, nomeVariante: true, precoCompra: true, custoMedioProducao: true },
          },
        },
      }),
      prisma.itensVendas.findMany({
        where: { venda: { contaId, status: "FATURADO", data: { gte: prevStart, lte: prevEnd } } },
        select: {
          quantidade: true,
          valor: true,
          produto: { select: { precoCompra: true, custoMedioProducao: true } },
        },
      }),
      prisma.movimentacoesEstoque.findMany({
        where: { contaId, tipo: "ENTRADA", status: "CONCLUIDO", data: { gte: start, lte: end } },
        select: {
          custo: true,
          quantidade: true,
          Produto: { select: { nome: true, nomeVariante: true } },
        },
      }),
      prisma.produto.findMany({
        where: { contaId },
        select: {
          nome: true,
          nomeVariante: true,
          estoque: true,
          minimo: true,
          controlaEstoque: true,
          materiaPrima: true,
          mostrarNoPdv: true,
          precoCompra: true,
          custoMedioProducao: true,
        },
      }),
      prisma.produtoBase.findMany({
        where: { contaId },
        select: { Categoria: { select: { nome: true } } },
      }),
      prisma.produtoBase.count({ where: { contaId } }),
      prisma.produto.count({ where: { contaId } }),
      prisma.produtoCategoria.count({ where: { contaId } }),
    ]);

    const num = (value: unknown) => Number(value || 0);
    const pad = (value: number) => String(value).padStart(2, "0");
    const delta = (atual: number, anterior: number) =>
      anterior > 0 ? ((atual - anterior) / anterior) * 100 : atual > 0 ? 100 : 0;
    const custoItem = (produto?: { precoCompra?: unknown; custoMedioProducao?: unknown } | null) =>
      num(produto?.custoMedioProducao ?? produto?.precoCompra ?? 0);

    // KPIs de receita/lucro no período e no anterior
    const receitaAtual = vendas.reduce((sum, v) => sum + num(v.valor), 0);
    const qtdVendas = vendas.length;
    const ticketAtual = qtdVendas ? receitaAtual / qtdVendas : 0;
    const receitaAnterior = vendasAnterior.reduce((sum, v) => sum + num(v.valor), 0);
    const qtdVendasAnterior = vendasAnterior.length;
    const ticketAnterior = qtdVendasAnterior ? receitaAnterior / qtdVendasAnterior : 0;

    const lucroAtual = itens.reduce(
      (sum, it) => sum + (num(it.valor) - custoItem(it.produto)) * num(it.quantidade),
      0
    );
    const lucroAnterior = itensAnterior.reduce(
      (sum, it) => sum + (num(it.valor) - custoItem(it.produto)) * num(it.quantidade),
      0
    );
    const itensVendidosAtual = itens.reduce((sum, it) => sum + num(it.quantidade), 0);
    const itensVendidosAnterior = itensAnterior.reduce((sum, it) => sum + num(it.quantidade), 0);

    const custoReposicoes = reposicoes.reduce(
      (sum, r) => sum + num(r.custo) * num(r.quantidade),
      0
    );

    // KPIs de catálogo/estoque (snapshot atual)
    const controlados = produtos.filter((p) => p.controlaEstoque === true);
    const estoqueBaixo = controlados.filter((p) => p.estoque > 0 && p.estoque <= p.minimo).length;
    const semEstoque = controlados.filter((p) => p.estoque <= 0).length;
    const materiasPrimas = produtos.filter((p) => p.materiaPrima === true).length;
    const produtosNoPdv = produtos.filter(
      (p) => (p.mostrarNoPdv === true || p.mostrarNoPdv === null) && !p.materiaPrima
    ).length;
    const valorEstoque = produtos.reduce((sum, p) => sum + custoItem(p) * p.estoque, 0);

    // Saúde do estoque
    const saude = { saudavel: 0, baixo: 0, semEstoque: 0, semControle: 0 };
    for (const p of produtos) {
      if (!p.controlaEstoque) saude.semControle++;
      else if (p.estoque <= 0) saude.semEstoque++;
      else if (p.estoque <= p.minimo) saude.baixo++;
      else saude.saudavel++;
    }

    // Estoque crítico (acionável)
    const estoqueCritico = controlados
      .filter((p) => p.estoque <= p.minimo)
      .map((p) => ({ nome: getNomeProduto(p), estoque: p.estoque, minimo: p.minimo }))
      .sort((a, b) => a.estoque - b.estoque)
      .slice(0, 8);

    // Distribuição por categoria
    const categoriaMap = new Map<string, number>();
    for (const base of produtosBase) {
      const nome = base.Categoria?.nome || "Sem categoria";
      categoriaMap.set(nome, (categoriaMap.get(nome) || 0) + 1);
    }
    const categoriasOrdenadas = [...categoriaMap.entries()].sort((a, b) => b[1] - a[1]);
    const catTop = categoriasOrdenadas.slice(0, 6);
    const catResto = categoriasOrdenadas.slice(6).reduce((sum, [, v]) => sum + v, 0);
    const distribuicaoCategorias = {
      labels: [...catTop.map(([l]) => l), ...(catResto > 0 ? ["Outras"] : [])],
      data: [...catTop.map(([, v]) => v), ...(catResto > 0 ? [catResto] : [])],
    };

    // Rankings por produto (receita e lucro)
    const produtoMap = new Map<
      string,
      { nome: string; valor: number; quantidade: number; lucro: number }
    >();
    for (const it of itens) {
      const nome = it.produto ? getNomeProduto(it.produto) : it.itemName || "Desconhecido";
      const key = it.produtoId ? `p:${it.produtoId}` : `n:${nome}`;
      const atual = produtoMap.get(key) || { nome, valor: 0, quantidade: 0, lucro: 0 };
      const qtd = num(it.quantidade);
      atual.valor += num(it.valor) * qtd;
      atual.quantidade += qtd;
      atual.lucro += (num(it.valor) - custoItem(it.produto)) * qtd;
      produtoMap.set(key, atual);
    }
    const produtosArr = [...produtoMap.values()];
    const topReceita = [...produtosArr]
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)
      .map((p) => ({ nome: p.nome, valor: p.valor, quantidade: p.quantidade }));
    const topLucro = [...produtosArr]
      .sort((a, b) => b.lucro - a.lucro)
      .slice(0, 6)
      .map((p) => ({ nome: p.nome, lucro: p.lucro }));

    // Mais repostos (por quantidade de entrada)
    const reposMap = new Map<string, number>();
    for (const r of reposicoes) {
      const nome = getNomeProduto(r.Produto ?? undefined);
      reposMap.set(nome, (reposMap.get(nome) || 0) + num(r.quantidade));
    }
    const maisRepostos = [...reposMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([nome, quantidade]) => ({ nome, quantidade }));

    // Curva de receita (por dia até 92 dias, senão por mês)
    const dayMs = 86_400_000;
    const diffDays = Math.max(1, Math.round(durationMs / dayMs) + 1);
    const usarDia = diffDays <= 92;
    const serieBuckets = new Map<string, number>();
    if (usarDia) {
      for (let i = 0; i < diffDays; i++) {
        const dia = new Date(start.getTime() + i * dayMs);
        serieBuckets.set(`${pad(dia.getDate())}/${pad(dia.getMonth() + 1)}`, 0);
      }
    }
    for (const v of vendas) {
      const dia = new Date(v.data);
      const key = usarDia
        ? `${pad(dia.getDate())}/${pad(dia.getMonth() + 1)}`
        : `${pad(dia.getMonth() + 1)}/${dia.getFullYear()}`;
      serieBuckets.set(key, (serieBuckets.get(key) || 0) + num(v.valor));
    }

    return res.json({
      periodo: { inicio: start, fim: end, anterior: { inicio: prevStart, fim: prevEnd } },
      kpis: {
        receita: { atual: receitaAtual, anterior: receitaAnterior, delta: delta(receitaAtual, receitaAnterior) },
        lucro: { atual: lucroAtual, anterior: lucroAnterior, delta: delta(lucroAtual, lucroAnterior) },
        ticketMedio: { atual: ticketAtual, anterior: ticketAnterior, delta: delta(ticketAtual, ticketAnterior) },
        itensVendidos: {
          atual: itensVendidosAtual,
          anterior: itensVendidosAnterior,
          delta: delta(itensVendidosAtual, itensVendidosAnterior),
        },
        custoReposicoes: { atual: custoReposicoes },
        valorEstoque: { atual: valorEstoque },
        estoqueBaixo: { atual: estoqueBaixo },
        semEstoque: { atual: semEstoque },
        totalProdutosBase,
        totalVariantes,
        totalCategorias,
        produtosNoPdv,
        materiasPrimas,
      },
      serieReceita: { labels: [...serieBuckets.keys()], data: [...serieBuckets.values()] },
      distribuicaoCategorias,
      saudeEstoque: {
        labels: ["Saudável", "Estoque baixo", "Sem estoque", "Estoque livre"],
        data: [saude.saudavel, saude.baixo, saude.semEstoque, saude.semControle],
      },
      topReceita,
      topLucro,
      maisRepostos,
      estoqueCritico,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao gerar o painel de produtos" });
  }
}
