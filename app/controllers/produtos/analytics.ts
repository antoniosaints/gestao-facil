import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import "dayjs/locale/pt-br";
import PDFDocument from "pdfkit";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";

dayjs.locale("pt-br");

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(2).toNumber();
const quantity = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(3).toNumber();

type AnalyticsParams = {
  contaId: number;
  produtoId: number;
  ano?: number;
  mes?: number;
  varianteId?: number;
  /** Uso interno no resumo da variante: agrega todo o histórico, sem alterar a API de analytics. */
  periodoCompleto?: boolean;
};

class AnalyticsRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
const formatNumber = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value || 0);
const formatPercent = (value: number) =>
  `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value || 0)}%`;

type VarianteParaResumo = {
  id: number;
  precoCompra: Decimal.Value | null;
  estoque: Decimal.Value;
};

type MovimentacaoParaResumo = {
  produtoId: number;
  tipo: "ENTRADA" | "SAIDA";
  quantidade: Decimal.Value;
  custo: Decimal.Value;
  frete?: Decimal.Value | null;
  desconto?: Decimal.Value | null;
};

/**
 * Base única para o custo do estoque: média ponderada das reposições
 * concluídas, com frete e desconto; sem reposições, preço de compra.
 */
export function calcularResumoEstoque(
  variantes: VarianteParaResumo[],
  movimentacoes: MovimentacaoParaResumo[],
) {
  const reposicaoPorVariante = new Map<number, { custoTotal: Decimal; quantidade: Decimal; registros: number }>();
  let totalEntradas = new Decimal(0);
  let totalSaidas = new Decimal(0);

  for (const movimentacao of movimentacoes) {
    const quantidadeMovimentada = new Decimal(movimentacao.quantidade);
    if (movimentacao.tipo === "SAIDA") {
      totalSaidas = totalSaidas.plus(quantidadeMovimentada);
      continue;
    }

    totalEntradas = totalEntradas.plus(quantidadeMovimentada);
    const atual = reposicaoPorVariante.get(movimentacao.produtoId) ?? {
      custoTotal: new Decimal(0),
      quantidade: new Decimal(0),
      registros: 0,
    };
    const custoEfetivo = quantidadeMovimentada
      .times(movimentacao.custo)
      .plus(movimentacao.frete ?? 0)
      .minus(movimentacao.desconto ?? 0);

    atual.custoTotal = atual.custoTotal.plus(custoEfetivo);
    atual.quantidade = atual.quantidade.plus(quantidadeMovimentada);
    atual.registros += 1;
    reposicaoPorVariante.set(movimentacao.produtoId, atual);
  }

  const custoPorVariante = new Map<number, Decimal>();
  let valorEstoque = new Decimal(0);
  let totalReposicoes = 0;
  let totalQuantidadeReposta = new Decimal(0);
  let custoTotalReposicoes = new Decimal(0);
  let estoqueAtual = new Decimal(0);

  for (const variante of variantes) {
    const reposicao = reposicaoPorVariante.get(variante.id);
    const custoUnitario = reposicao && reposicao.quantidade.gt(0)
      ? reposicao.custoTotal.div(reposicao.quantidade)
      : new Decimal(variante.precoCompra ?? 0);

    custoPorVariante.set(variante.id, custoUnitario);
    valorEstoque = valorEstoque.plus(custoUnitario.times(variante.estoque));
    estoqueAtual = estoqueAtual.plus(variante.estoque);

    if (reposicao) {
      totalReposicoes += reposicao.registros;
      totalQuantidadeReposta = totalQuantidadeReposta.plus(reposicao.quantidade);
      custoTotalReposicoes = custoTotalReposicoes.plus(reposicao.custoTotal);
    }
  }

  return {
    custoPorVariante,
    valorEstoque,
    totalReposicoes,
    totalQuantidadeReposta,
    custoTotalReposicoes,
    totalEntradas,
    totalSaidas,
    estoqueAtual,
  };
}

/**
 * Analytics do produto base. O custo de cada variante é calculado com base
 * no custo médio ponderado das reposições concluídas; sem reposição, usa o
 * preço de compra cadastrado como fallback. Assim não usamos o preço atual
 * para reescrever o lucro de vendas já registradas.
 */
export async function buildProdutoAnalytics({
  contaId,
  produtoId,
  ano: requestedYear,
  mes: requestedMonth,
  varianteId: requestedVarianteId,
  periodoCompleto = false,
}: AnalyticsParams) {
    const ano = Number.isInteger(requestedYear) && requestedYear! >= 2000 && requestedYear! <= 2100
      ? requestedYear!
      : dayjs().year();
    const mes = Number.isInteger(requestedMonth) && requestedMonth! >= 1 && requestedMonth! <= 12
      ? requestedMonth!
      : undefined;

    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      throw new AnalyticsRequestError("Produto inválido", 400);
    }

    const produto = await prisma.produtoBase.findFirst({
      where: { id: produtoId, contaId },
      select: {
        id: true,
        nome: true,
        variantes: {
          select: { id: true, nomeVariante: true, precoCompra: true, estoque: true },
        },
      },
    });

    if (!produto) {
      throw new AnalyticsRequestError("Produto não encontrado", 404);
    }

    const variantesSelecionadas = requestedVarianteId
      ? produto.variantes.filter((variante) => variante.id === requestedVarianteId)
      : produto.variantes;

    if (requestedVarianteId && !variantesSelecionadas.length) {
      throw new AnalyticsRequestError("Variante não pertence a este produto", 400);
    }

    const varianteIds = variantesSelecionadas.map((variante) => variante.id);
    const inicioAno = dayjs(`${ano}-01-01`).startOf("day").toDate();
    const fimAno = dayjs(`${ano}-12-31`).endOf("day").toDate();

    const filtroDePeriodo = periodoCompleto
      ? {}
      : { data: { gte: inicioAno, lte: fimAno } };

    const [reposicoes, saidas, datasSaidas, moduloOuriveAtivo] = await Promise.all([
      prisma.movimentacoesEstoque.findMany({
        where: {
          contaId,
          produtoId: { in: varianteIds },
          tipo: "ENTRADA",
          status: "CONCLUIDO",
        },
        select: { produtoId: true, tipo: true, quantidade: true, custo: true, frete: true, desconto: true },
      }),
      prisma.movimentacoesEstoque.findMany({
        where: {
          contaId,
          produtoId: { in: varianteIds },
          tipo: "SAIDA",
          status: "CONCLUIDO",
          ...filtroDePeriodo,
        },
        select: {
          id: true,
          produtoId: true,
          quantidade: true,
          custo: true,
          data: true,
          vendaId: true,
          ordemId: true,
        },
      }),
      prisma.movimentacoesEstoque.findMany({
        where: {
          contaId,
          produtoId: { in: varianteIds },
          tipo: "SAIDA",
          status: "CONCLUIDO",
        },
        select: { data: true },
      }),
      contaHasActiveModule(contaId, "ourives"),
    ]);

    const resumoEstoque = calcularResumoEstoque(variantesSelecionadas, reposicoes);
    const {
      custoPorVariante,
      valorEstoque,
      totalReposicoes,
      totalQuantidadeReposta,
      custoTotalReposicoes,
    } = resumoEstoque;

    const vendaIds = [...new Set(saidas.flatMap((saida) => saida.vendaId ? [saida.vendaId] : []))];
    const ordemIds = [...new Set(saidas.flatMap((saida) => saida.ordemId ? [saida.ordemId] : []))];
    const [itensVenda, itensOrdem, vendasRelacionadas, ordensRelacionadas] = await Promise.all([
      prisma.itensVendas.findMany({
        where: { vendaId: { in: vendaIds }, produtoId: { in: varianteIds } },
        select: { vendaId: true, produtoId: true, quantidade: true, valor: true },
      }),
      prisma.itensOrdensServico.findMany({
        where: { ordemId: { in: ordemIds }, produtoId: { in: varianteIds } },
        select: { ordemId: true, produtoId: true, quantidade: true, valor: true },
      }),
      prisma.vendas.findMany({
        where: { contaId, id: { in: vendaIds } },
        select: { id: true, faturado: true, status: true },
      }),
      prisma.ordensServico.findMany({
        where: { contaId, id: { in: ordemIds } },
        select: { id: true, status: true },
      }),
    ]);
    const ordensOurive = moduloOuriveAtivo
      ? await (prisma as any).ouriveOrdem.findMany({
          where: { contaId, ordemServicoId: { in: ordemIds } },
          select: { id: true, ordemServicoId: true, faturadaEm: true },
        })
      : [];

    // Linhas de venda e de OS têm preço direto. O rateio evita duplicidade se uma
    // mesma variante foi registrada em mais de uma movimentação no documento.
    const receitaDireta = new Map<string, { receita: Decimal; quantidade: Decimal }>();
    const addReceitaDireta = (origem: "VENDA" | "OS", documentoId: number, varianteId: number, valor: Decimal.Value, qtd: Decimal.Value) => {
      const key = `${origem}:${documentoId}:${varianteId}`;
      const atual = receitaDireta.get(key) ?? { receita: new Decimal(0), quantidade: new Decimal(0) };
      atual.receita = atual.receita.plus(new Decimal(valor).times(qtd));
      atual.quantidade = atual.quantidade.plus(qtd);
      receitaDireta.set(key, atual);
    };
    for (const item of itensVenda) {
      if (item.produtoId) addReceitaDireta("VENDA", item.vendaId, item.produtoId, item.valor, item.quantidade);
    }
    for (const item of itensOrdem) {
      if (item.produtoId) addReceitaDireta("OS", item.ordemId, item.produtoId, item.valor, item.quantidade);
    }

    const ourivePorOrdemServico = new Map<number, { id: number; faturadaEm: Date | null }>(
      ordensOurive.map((ordem: { id: number; ordemServicoId: number; faturadaEm: Date | null }) => [
        ordem.ordemServicoId,
        ordem,
      ]),
    );
    const vendaReconhecida = new Map(
      vendasRelacionadas.map((venda) => [
        venda.id,
        venda.faturado || ["FATURADO", "FINALIZADO"].includes(venda.status),
      ]),
    );
    const ordemReconhecida = new Map(
      ordensRelacionadas.map((ordem) => [
        ordem.id,
        ["APROVADA", "FATURADA"].includes(ordem.status),
      ]),
    );
    const ouriveIds = ordensOurive.map((ordem: { id: number }) => ordem.id);
    const [orcamentosOurive, saidasOurive] = moduloOuriveAtivo
      ? await Promise.all([
          (prisma as any).ouriveOrcamento.findMany({
            where: { ordemOuriveId: { in: ouriveIds }, aprovadoEm: { not: null }, invalidoEm: null },
            select: { ordemOuriveId: true, valorFinal: true, versao: true },
            orderBy: { versao: "desc" },
          }),
          prisma.movimentacoesEstoque.findMany({
            where: { contaId, ordemId: { in: ordemIds }, tipo: "SAIDA", status: "CONCLUIDO" },
            select: { id: true, ordemId: true, quantidade: true, custo: true },
          }),
        ])
      : [[], []] as const;
    const orcamentoPorOurive = new Map<number, Decimal>();
    for (const orcamento of orcamentosOurive) {
      if (!orcamentoPorOurive.has(orcamento.ordemOuriveId)) {
        orcamentoPorOurive.set(orcamento.ordemOuriveId, new Decimal(orcamento.valorFinal));
      }
    }
    const pesoOurivePorOrdem = new Map<number, Decimal>();
    for (const saida of saidasOurive) {
      if (!saida.ordemId || !ourivePorOrdemServico.has(saida.ordemId)) continue;
      const peso = new Decimal(saida.custo).times(saida.quantidade);
      pesoOurivePorOrdem.set(saida.ordemId, (pesoOurivePorOrdem.get(saida.ordemId) ?? new Decimal(0)).plus(peso));
    }

    const meses = Array.from({ length: 12 }, (_, index) => ({
      mes: dayjs().month(index).format("MMM").replace(".", ""),
      vendasIds: new Set<number>(),
      ordensServicoIds: new Set<number>(),
      ordensOuriveIds: new Set<number>(),
      documentosReconhecidos: new Set<string>(),
      unidadesVendas: new Decimal(0),
      unidadesOrdensServico: new Decimal(0),
      unidadesOrdensOurive: new Decimal(0),
      unidadesOutrasSaidas: new Decimal(0),
      faturamento: new Decimal(0),
      valorVendas: new Decimal(0),
      custo: new Decimal(0),
    }));

    let faturamento = new Decimal(0);
    let custoDasSaidas = new Decimal(0);
    let unidadesSaidas = new Decimal(0);
    const vendasComSaida = new Set<number>();
    const ordensServicoComSaida = new Set<number>();
    const ordensOuriveComSaida = new Set<number>();
    const documentosReconhecidos = new Set<string>();
    let unidadesOutrasSaidas = new Decimal(0);

    for (const saida of saidas) {
      const mes = meses[dayjs(saida.data).month()];
      const qtd = new Decimal(saida.quantidade);
      const custoSaida = (custoPorVariante.get(saida.produtoId) ?? new Decimal(0)).times(qtd);
      let receitaSaida = new Decimal(0);

      if (saida.vendaId) {
        const receita = receitaDireta.get(`VENDA:${saida.vendaId}:${saida.produtoId}`);
        receitaSaida = vendaReconhecida.get(saida.vendaId) && receita && receita.quantidade.gt(0)
          ? receita.receita.times(qtd).div(receita.quantidade)
          : new Decimal(0);
        if (vendaReconhecida.get(saida.vendaId)) {
          const documento = `VENDA:${saida.vendaId}`;
          documentosReconhecidos.add(documento);
          mes.documentosReconhecidos.add(documento);
          mes.valorVendas = mes.valorVendas.plus(receitaSaida);
        }
        mes.vendasIds.add(saida.vendaId);
        mes.unidadesVendas = mes.unidadesVendas.plus(qtd);
        vendasComSaida.add(saida.vendaId);
      } else if (saida.ordemId) {
        const ordemOurive = ourivePorOrdemServico.get(saida.ordemId);
        if (ordemOurive) {
          const valorOrcamento = orcamentoPorOurive.get(ordemOurive.id) ?? new Decimal(0);
          const pesoTotal = pesoOurivePorOrdem.get(saida.ordemId) ?? new Decimal(0);
          const pesoSaida = new Decimal(saida.custo).times(qtd);
          receitaSaida = ordemOurive.faturadaEm && pesoTotal.gt(0)
            ? valorOrcamento.times(pesoSaida).div(pesoTotal)
            : new Decimal(0);
          if (ordemOurive.faturadaEm) {
            const documento = `OURIVE:${ordemOurive.id}`;
            documentosReconhecidos.add(documento);
            mes.documentosReconhecidos.add(documento);
          }
          mes.ordensOuriveIds.add(ordemOurive.id);
          mes.unidadesOrdensOurive = mes.unidadesOrdensOurive.plus(qtd);
          ordensOuriveComSaida.add(ordemOurive.id);
        } else {
          const receita = receitaDireta.get(`OS:${saida.ordemId}:${saida.produtoId}`);
          receitaSaida = ordemReconhecida.get(saida.ordemId) && receita && receita.quantidade.gt(0)
            ? receita.receita.times(qtd).div(receita.quantidade)
            : new Decimal(0);
          if (ordemReconhecida.get(saida.ordemId)) {
            const documento = `OS:${saida.ordemId}`;
            documentosReconhecidos.add(documento);
            mes.documentosReconhecidos.add(documento);
          }
          mes.ordensServicoIds.add(saida.ordemId);
          mes.unidadesOrdensServico = mes.unidadesOrdensServico.plus(qtd);
          ordensServicoComSaida.add(saida.ordemId);
        }
      } else {
        mes.unidadesOutrasSaidas = mes.unidadesOutrasSaidas.plus(qtd);
        unidadesOutrasSaidas = unidadesOutrasSaidas.plus(qtd);
      }

      mes.faturamento = mes.faturamento.plus(receitaSaida);
      mes.custo = mes.custo.plus(custoSaida);
      faturamento = faturamento.plus(receitaSaida);
      custoDasSaidas = custoDasSaidas.plus(custoSaida);
      unidadesSaidas = unidadesSaidas.plus(qtd);
    }

    const lucroLiquido = faturamento.minus(custoDasSaidas);
    const estoqueAtual = resumoEstoque.estoqueAtual;
    const anosDisponiveis = [...new Set([dayjs().year(), ano, ...datasSaidas.map((saida) => dayjs(saida.data).year())])]
      .sort((a, b) => b - a);
    const mesesParaKpi = mes ? [meses[mes - 1]] : meses;
    const faturamentoFiltrado = mesesParaKpi.reduce((total, item) => total.plus(item.faturamento), new Decimal(0));
    const custoFiltrado = mesesParaKpi.reduce((total, item) => total.plus(item.custo), new Decimal(0));
    const unidadesFiltradas = mesesParaKpi.reduce(
      (total, item) => total.plus(item.unidadesVendas).plus(item.unidadesOrdensServico).plus(item.unidadesOrdensOurive).plus(item.unidadesOutrasSaidas),
      new Decimal(0),
    );
    const outrasSaidasFiltradas = mesesParaKpi.reduce(
      (total, item) => total.plus(item.unidadesOutrasSaidas),
      new Decimal(0),
    );
    const vendasFiltradas = new Set(mesesParaKpi.flatMap((item) => [...item.vendasIds]));
    const ordensServicoFiltradas = new Set(mesesParaKpi.flatMap((item) => [...item.ordensServicoIds]));
    const ordensOuriveFiltradas = new Set(mesesParaKpi.flatMap((item) => [...item.ordensOuriveIds]));
    const documentosFiltrados = new Set(mesesParaKpi.flatMap((item) => [...item.documentosReconhecidos]));
    const valorVendasFiltrado = mesesParaKpi.reduce(
      (total, item) => total.plus(item.valorVendas),
      new Decimal(0),
    );
    const lucroFiltrado = faturamentoFiltrado.minus(custoFiltrado);

    return {
      ano,
      mes: mes ?? null,
      moduloOuriveAtivo,
      produto: {
        id: produto.id,
        nome: produto.nome,
        variante: requestedVarianteId
          ? {
              id: variantesSelecionadas[0].id,
              nome: variantesSelecionadas[0].nomeVariante,
            }
          : null,
      },
      anosDisponiveis,
      kpis: {
        faturamento: money(faturamentoFiltrado),
        lucroLiquido: money(lucroFiltrado),
        markup: custoFiltrado.gt(0) ? money(lucroFiltrado.div(custoFiltrado).times(100)) : 0,
        vendas: vendasFiltradas.size,
        ordensServico: ordensServicoFiltradas.size,
        ...(moduloOuriveAtivo ? { ordensOurive: ordensOuriveFiltradas.size } : {}),
        unidadesSaidas: quantity(unidadesFiltradas),
        unidadesOutrasSaidas: quantity(outrasSaidasFiltradas),
        ticketMedio: documentosFiltrados.size ? money(faturamentoFiltrado.div(documentosFiltrados.size)) : 0,
        custoMedioAplicado: unidadesFiltradas.gt(0) ? money(custoFiltrado.div(unidadesFiltradas)) : 0,
        custoMedioReposicao: totalQuantidadeReposta.gt(0)
          ? money(custoTotalReposicoes.div(totalQuantidadeReposta))
          : 0,
        totalReposicoes,
        valorReposicoes: money(custoTotalReposicoes),
        valorVendas: money(valorVendasFiltrado),
        totalEntradas: quantity(resumoEstoque.totalEntradas),
        estoqueAtual: quantity(estoqueAtual),
        valorEstoque: money(valorEstoque),
      },
      mensal: meses.map((mes) => {
        const lucro = mes.faturamento.minus(mes.custo);
        return {
          mes: mes.mes,
          vendas: mes.vendasIds.size,
          ordensServico: mes.ordensServicoIds.size,
          ...(moduloOuriveAtivo ? { ordensOurive: mes.ordensOuriveIds.size } : {}),
          unidadesVendas: quantity(mes.unidadesVendas),
          unidadesOrdensServico: quantity(mes.unidadesOrdensServico),
          ...(moduloOuriveAtivo
            ? { unidadesOrdensOurive: quantity(mes.unidadesOrdensOurive) }
            : {}),
          unidadesOutrasSaidas: quantity(mes.unidadesOutrasSaidas),
          unidadesSaidas: quantity(mes.unidadesVendas.plus(mes.unidadesOrdensServico).plus(mes.unidadesOrdensOurive).plus(mes.unidadesOutrasSaidas)),
          faturamento: money(mes.faturamento),
          lucroLiquido: money(lucro),
          markup: mes.custo.gt(0) ? money(lucro.div(mes.custo).times(100)) : 0,
        };
      }),
    };
}

function getAnalyticsParams(req: Request): AnalyticsParams {
  const produtoId = Number(req.params.produtoId);
  const ano = Number(req.query.ano);
  const rawMes = req.query.mes;
  const mes = rawMes === undefined || rawMes === "" ? undefined : Number(rawMes);
  const rawVarianteId = req.query.varianteId;
  const varianteId = rawVarianteId === undefined || rawVarianteId === ""
    ? undefined
    : Number(rawVarianteId);

  if (!Number.isInteger(produtoId) || produtoId <= 0) {
    throw new AnalyticsRequestError("Produto inválido", 400);
  }
  if (varianteId !== undefined && (!Number.isInteger(varianteId) || varianteId <= 0)) {
    throw new AnalyticsRequestError("Variante inválida", 400);
  }
  if (mes !== undefined && (!Number.isInteger(mes) || mes < 1 || mes > 12)) {
    throw new AnalyticsRequestError("Mês inválido", 400);
  }

  return {
    contaId: getCustomRequest(req).customData.contaId,
    produtoId,
    ano,
    mes,
    varianteId,
  };
}

export async function getProdutoAnalytics(req: Request, res: Response): Promise<any> {
  try {
    return res.json(await buildProdutoAnalytics(getAnalyticsParams(req)));
  } catch (error) {
    if (error instanceof AnalyticsRequestError) {
      return res.status(error.status).json({ message: error.message });
    }
    handleError(res, error);
  }
}

export async function exportProdutoAnalyticsPdf(req: Request, res: Response): Promise<any> {
  try {
    const analytics = await buildProdutoAnalytics(getAnalyticsParams(req));
    const scope = analytics.produto.variante
      ? `Variante: ${analytics.produto.variante.nome}`
      : "Todas as variantes";
    const periodo = analytics.mes
      ? `${dayjs().month(analytics.mes - 1).format("MMMM")} de ${analytics.ano}`
      : `Ano ${analytics.ano}`;
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="analytics_${analytics.produto.nome.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}_${analytics.ano}.pdf"`,
    );
    doc.pipe(res);

    const pageWidth = doc.page.width - 80;
    const drawMetric = (x: number, y: number, label: string, value: string) => {
      doc.roundedRect(x, y, 166, 58, 6).fillAndStroke("#F8FAFC", "#E2E8F0");
      doc.fillColor("#64748B").fontSize(8).font("Helvetica").text(label, x + 10, y + 10, { width: 146 });
      doc.fillColor("#0F172A").fontSize(13).font("Helvetica-Bold").text(value, x + 10, y + 27, { width: 146 });
    };

    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(19).text("Analytics do produto");
    doc.fillColor("#475569").font("Helvetica").fontSize(10)
      .text(analytics.produto.nome, { continued: false })
      .text(`${scope} - ${periodo}`)
      .text(`Emitido em ${dayjs().format("DD/MM/YYYY HH:mm")}`);

    const metricsY = 130;
    drawMetric(40, metricsY, "Faturamento", formatCurrency(analytics.kpis.faturamento));
    drawMetric(216, metricsY, "Lucro líquido", formatCurrency(analytics.kpis.lucroLiquido));
    drawMetric(392, metricsY, "Markup", formatPercent(analytics.kpis.markup));
    drawMetric(40, metricsY + 70, "Unidades em saída", formatNumber(analytics.kpis.unidadesSaidas));
    drawMetric(216, metricsY + 70, "Custo médio aplicado", formatCurrency(analytics.kpis.custoMedioAplicado));
    drawMetric(392, metricsY + 70, "Valor em estoque", formatCurrency(analytics.kpis.valorEstoque));

    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("Resultado mensal do ano", 40, 288);
    const columns = analytics.moduloOuriveAtivo
      ? [40, 93, 168, 243, 324, 404, 477]
      : [40, 110, 205, 300, 395, 485];
    const headers = analytics.moduloOuriveAtivo
      ? ["Mês", "Faturamento", "Lucro", "Markup", "Vendas", "OS", "Ourive"]
      : ["Mês", "Faturamento", "Lucro", "Markup", "Vendas", "OS"];
    doc.rect(40, 310, pageWidth, 20).fill("#0F172A");
    headers.forEach((header, index) => {
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7).text(header, columns[index] + 5, 317, {
        width: (columns[index + 1] ?? 555) - columns[index] - 7,
        align: index > 0 ? "right" : "left",
      });
    });
    let y = 330;
    analytics.mensal.forEach((month, index) => {
      if (index % 2 === 0) doc.rect(40, y, pageWidth, 20).fill("#F8FAFC");
      const values = [
        month.mes,
        formatCurrency(month.faturamento),
        formatCurrency(month.lucroLiquido),
        formatPercent(month.markup),
        formatNumber(month.unidadesVendas),
        formatNumber(month.unidadesOrdensServico),
        ...(analytics.moduloOuriveAtivo ? [formatNumber(month.unidadesOrdensOurive ?? 0)] : []),
      ];
      values.forEach((value, column) => {
        doc.fillColor("#1E293B").font("Helvetica").fontSize(7.5).text(value, columns[column] + 5, y + 7, {
          width: (columns[column + 1] ?? 555) - columns[column] - 7,
          align: column > 0 ? "right" : "left",
        });
      });
      y += 20;
    });

    doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(13).text("Saídas por origem", 40, y + 20);
    const outputs = [
      ["Vendas", analytics.mensal.reduce((total, month) => total + month.unidadesVendas, 0)],
      ["Ordens de serviço", analytics.mensal.reduce((total, month) => total + month.unidadesOrdensServico, 0)],
      ...(analytics.moduloOuriveAtivo
        ? [["Ordens do ourive", analytics.mensal.reduce((total, month) => total + (month.unidadesOrdensOurive ?? 0), 0)]]
        : []),
      ["Outras saídas", analytics.mensal.reduce((total, month) => total + month.unidadesOutrasSaidas, 0)],
    ];
    outputs.forEach(([label, total], index) => {
      const outputY = y + 47 + index * 19;
      doc.fillColor(index % 2 === 0 ? "#F8FAFC" : "#FFFFFF").rect(40, outputY, pageWidth, 19).fill();
      doc.fillColor("#334155").font("Helvetica").fontSize(9).text(String(label), 50, outputY + 5);
      doc.fillColor("#0F172A").font("Helvetica-Bold").text(`${formatNumber(Number(total))} unidade(s)`, 360, outputY + 5, { width: 180, align: "right" });
    });
    doc.fillColor("#64748B").font("Helvetica").fontSize(8)
      .text("O lucro líquido considera o custo médio das reposições concluídas; sem reposição, usa o preço de compra cadastrado.", 40, y + 142, { width: pageWidth });
    doc.end();
  } catch (error) {
    if (error instanceof AnalyticsRequestError) {
      return res.status(error.status).json({ message: error.message });
    }
    handleError(res, error);
  }
}
