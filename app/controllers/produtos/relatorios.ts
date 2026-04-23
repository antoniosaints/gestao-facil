import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { formatarValorMonetario } from "../../utils/formatters";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { generateBarcodesStream } from "../../services/barcodeService";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";
import { ResponseHandler } from "../../utils/response";

type ReportTargetType = "BASE" | "VARIANTE";
type ReportMetric = {
  label: string;
  value: string;
  color?: string;
};

type ProductSalesRow = {
  data: Date;
  vendaUid: string;
  cliente: string;
  produtoBase: string;
  variante: string;
  quantidade: number;
  valorUnitario: Decimal;
  totalVenda: Decimal;
  custoUnitario: Decimal;
  custoTotal: Decimal;
  lucro: Decimal;
};

type ProductSalesReportData = {
  targetType: ReportTargetType;
  targetId: number;
  produtoBase: string;
  variante?: string | null;
  periodo: string;
  rows: ProductSalesRow[];
  totalQuantidade: number;
  totalVendas: number;
  receitaBruta: Decimal;
  custoEstimado: Decimal;
  lucroEstimado: Decimal;
  ticketMedioVenda: Decimal;
  ticketMedioUnidade: Decimal;
  margemEstimada: Decimal;
};

function getContaId(req: Request) {
  return Number(getCustomRequest(req).customData.contaId);
}

async function getLogoPath(profile?: string | null) {
  return resolveRenderableImageSource(profile);
}

function getVariantName(nomeVariante?: string | null) {
  return nomeVariante?.trim() || "Padrão";
}

function getCombinedProductName(params: {
  produtoBase?: string | null;
  nome?: string | null;
  nomeVariante?: string | null;
}) {
  const baseName = params.produtoBase || params.nome || "Produto";
  return `${baseName} / ${getVariantName(params.nomeVariante)}`;
}

function getPeriodLabel(inicio?: Date | null, fim?: Date | null, fallback = "Histórico geral") {
  if (!inicio && !fim) return fallback;
  return `${inicio ? dayjs(inicio).format("DD/MM/YYYY") : "Início aberto"} até ${
    fim ? dayjs(fim).format("DD/MM/YYYY") : "Hoje"
  }`;
}

function parseOptionalDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ensurePageSpace(doc: PDFKit.PDFDocument, heightNeeded = 40) {
  if (doc.y + heightNeeded <= doc.page.height - doc.page.margins.bottom) {
    return;
  }

  doc.addPage();
  doc.y = doc.page.margins.top;
}

async function drawHeader(
  doc: PDFKit.PDFDocument,
  conta: {
    nome: string;
    nomeFantasia?: string | null;
    email?: string | null;
    categoria?: string | null;
    documento?: string | null;
    profile?: string | null;
  },
  params: {
    title: string;
    subtitleLines?: string[];
  }
) {
  const marginTop = 40;
  const marginLeft = 40;
  const imageWidth = 72;
  const imageHeight = 72;
  const textLeft = marginLeft + imageWidth + 20;

  doc.image(await getLogoPath(conta.profile), marginLeft, marginTop, {
    fit: [imageWidth, imageHeight],
  });

  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .fillColor("#111827")
    .text(params.title, textLeft, marginTop, {
      width: 420,
    });

  const subtitleLines = params.subtitleLines ?? [];
  let currentY = marginTop + 28;

  doc.font("Roboto").fontSize(10).fillColor("#4B5563");
  for (const line of subtitleLines) {
    doc.text(line, textLeft, currentY, {
      width: 420,
    });
    currentY += 14;
  }

  const headerHeight = Math.max(imageHeight, currentY - marginTop);
  doc.y = marginTop + headerHeight + 18;
  doc.fillColor("#111827");
}

function drawMetricGrid(doc: PDFKit.PDFDocument, metrics: ReportMetric[]) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 12;
  const cols = 2;
  const cardWidth = (pageWidth - gap) / cols;
  const cardHeight = 56;
  const startX = doc.page.margins.left;
  const startY = doc.y;

  metrics.forEach((metric, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = startX + col * (cardWidth + gap);
    const y = startY + row * (cardHeight + gap);

    ensurePageSpace(doc, cardHeight + gap);

    doc
      .roundedRect(x, y, cardWidth, cardHeight, 10)
      .lineWidth(1)
      .strokeColor("#E5E7EB")
      .fillAndStroke("#F9FAFB", "#E5E7EB");

    doc
      .font("Roboto")
      .fontSize(9)
      .fillColor("#6B7280")
      .text(metric.label, x + 12, y + 10, {
        width: cardWidth - 24,
      });

    doc
      .font("Roboto-Bold")
      .fontSize(12)
      .fillColor(metric.color || "#111827")
      .text(metric.value, x + 12, y + 26, {
        width: cardWidth - 24,
      });
  });

  const totalRows = Math.ceil(metrics.length / cols);
  doc.y = startY + totalRows * (cardHeight + gap);
  doc.fillColor("#111827");
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  columns: Array<{ label: string; x: number; width?: number }>
) {
  ensurePageSpace(doc, 24);
  const headerY = doc.y;

  doc.font("Roboto-Bold").fontSize(9).fillColor("#111827");
  columns.forEach((column) => {
    doc.text(column.label, column.x, headerY, {
      width: column.width,
    });
  });

  doc
    .moveTo(doc.page.margins.left, headerY + 16)
    .lineTo(doc.page.width - doc.page.margins.right, headerY + 16)
    .strokeColor("#D1D5DB")
    .stroke();

  doc.font("Roboto").fontSize(8).fillColor("#111827");
  doc.y = headerY + 20;
}

function drawFooterTotals(
  doc: PDFKit.PDFDocument,
  totals: Array<{ label: string; value: string; color?: string }>
) {
  ensurePageSpace(doc, totals.length * 18 + 16);
  doc.moveDown(0.5);

  totals.forEach((total) => {
    const lineY = doc.y;
    doc.font("Roboto-Bold").fontSize(10).fillColor("#111827").text(total.label, 340, lineY, {
      width: 130,
      align: "right",
    });
    doc.font("Roboto-Bold").fontSize(10).fillColor(total.color || "#111827").text(total.value, 480, lineY, {
      width: 90,
      align: "right",
    });
    doc.y = lineY + 16;
  });

  doc.fillColor("#111827");
}

async function buildSalesReportData(params: {
  contaId: number;
  targetType: ReportTargetType;
  targetId: number;
  inicio?: Date | null;
  fim?: Date | null;
}) {
  if (!params.targetId || Number.isNaN(params.targetId)) {
    throw new Error("Selecione um produto base ou uma variante válida.");
  }

  let produtoBase = "";
  let variante: string | null = null;
  let variantIds: number[] = [];

  if (params.targetType === "BASE") {
    const base = await prisma.produtoBase.findFirst({
      where: {
        id: params.targetId,
        contaId: params.contaId,
      },
      include: {
        variantes: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!base) {
      throw new Error("Produto base não encontrado.");
    }

    produtoBase = base.nome;
    variantIds = base.variantes.map((item) => item.id);
  } else {
    const product = await prisma.produto.findFirst({
      where: {
        id: params.targetId,
        contaId: params.contaId,
      },
      include: {
        ProdutoBase: {
          select: {
            nome: true,
          },
        },
      },
    });

    if (!product) {
      throw new Error("Variante não encontrada.");
    }

    produtoBase = product.ProdutoBase?.nome || product.nome;
    variante = getVariantName(product.nomeVariante);
    variantIds = [product.id];
  }

  const rowsDb = variantIds.length
    ? await prisma.itensVendas.findMany({
        where: {
          produtoId: { in: variantIds },
          venda: {
            contaId: params.contaId,
            status: "FATURADO",
            ...(params.inicio || params.fim
              ? {
                  data: {
                    ...(params.inicio ? { gte: params.inicio } : {}),
                    ...(params.fim ? { lte: params.fim } : {}),
                  },
                }
              : {}),
          },
        },
        orderBy: {
          venda: {
            data: "desc",
          },
        },
        select: {
          quantidade: true,
          valor: true,
          produto: {
            select: {
              nome: true,
              nomeVariante: true,
              codigo: true,
              unidade: true,
              precoCompra: true,
              custoMedioProducao: true,
              ProdutoBase: {
                select: {
                  nome: true,
                },
              },
            },
          },
          venda: {
            select: {
              Uid: true,
              data: true,
              cliente: {
                select: {
                  nome: true,
                },
              },
            },
          },
        },
      })
    : [];

  const rows: ProductSalesRow[] = rowsDb.map((item) => {
    const quantidade = Number(item.quantidade || 0);
    const valorUnitario = new Decimal(item.valor || 0);
    const totalVenda = valorUnitario.times(quantidade);
    const custoUnitario = new Decimal(
      item.produto?.custoMedioProducao ?? item.produto?.precoCompra ?? 0
    );
    const custoTotal = custoUnitario.times(quantidade);
    const lucro = totalVenda.minus(custoTotal);

    return {
      data: item.venda.data,
      vendaUid: item.venda.Uid,
      cliente: item.venda.cliente?.nome || "Consumidor final",
      produtoBase: item.produto?.ProdutoBase?.nome || item.produto?.nome || produtoBase,
      variante: getVariantName(item.produto?.nomeVariante),
      quantidade,
      valorUnitario,
      totalVenda,
      custoUnitario,
      custoTotal,
      lucro,
    };
  });

  const receitaBruta = rows.reduce(
    (acc, row) => acc.plus(row.totalVenda),
    new Decimal(0)
  );
  const custoEstimado = rows.reduce(
    (acc, row) => acc.plus(row.custoTotal),
    new Decimal(0)
  );
  const lucroEstimado = receitaBruta.minus(custoEstimado);
  const totalQuantidade = rows.reduce((acc, row) => acc + row.quantidade, 0);
  const totalVendas = new Set(rows.map((row) => row.vendaUid)).size;
  const ticketMedioVenda = totalVendas > 0 ? receitaBruta.div(totalVendas) : new Decimal(0);
  const ticketMedioUnidade = totalQuantidade > 0 ? receitaBruta.div(totalQuantidade) : new Decimal(0);
  const margemEstimada = receitaBruta.gt(0)
    ? lucroEstimado.div(receitaBruta).times(100)
    : new Decimal(0);

  return {
    targetType: params.targetType,
    targetId: params.targetId,
    produtoBase,
    variante,
    periodo: getPeriodLabel(params.inicio, params.fim, "Histórico geral de vendas"),
    rows,
    totalQuantidade,
    totalVendas,
    receitaBruta,
    custoEstimado,
    lucroEstimado,
    ticketMedioVenda,
    ticketMedioUnidade,
    margemEstimada,
  } satisfies ProductSalesReportData;
}

async function renderCatalogReport(
  doc: PDFKit.PDFDocument,
  params: {
    conta: {
      nome: string;
      nomeFantasia?: string | null;
      email?: string | null;
      categoria?: string | null;
      documento?: string | null;
      profile?: string | null;
    };
    products: Array<{
      codigo?: string | null;
      nome: string;
      nomeVariante?: string | null;
      preco: Decimal | number | string;
      estoque: number;
      ProdutoBase?: {
        nome: string;
      } | null;
    }>;
    periodo: string;
  }
) {
  await drawHeader(doc, params.conta, {
    title: `Relatório de catálogo e estoque - ${params.conta.nome}`,
    subtitleLines: [
      `E-mail: ${params.conta.email || "Não informado"}`,
      `Documento: ${params.conta.documento || "Não informado"}`,
      `Período do cadastro: ${params.periodo}`,
      `Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`,
    ],
  });

  drawMetricGrid(doc, [
    {
      label: "Variantes listadas",
      value: `${params.products.length}`,
      color: "#2563EB",
    },
    {
      label: "Valor total em estoque",
      value: formatarValorMonetario(
        params.products.reduce(
          (acc, product) => acc.plus(new Decimal(product.preco).times(product.estoque)),
          new Decimal(0)
        )
      ),
      color: "#15803D",
    },
  ]);

  drawTableHeader(doc, [
    { label: "Código", x: 30, width: 60 },
    { label: "Produto base", x: 95, width: 170 },
    { label: "Variante", x: 270, width: 110 },
    { label: "Preço", x: 385, width: 70 },
    { label: "Qtd.", x: 460, width: 40 },
    { label: "Total", x: 505, width: 70 },
  ]);

  params.products.forEach((product) => {
    const lineHeight = 16;
    ensurePageSpace(doc, lineHeight + 10);

    if (doc.y === doc.page.margins.top) {
      drawTableHeader(doc, [
        { label: "Código", x: 30, width: 60 },
        { label: "Produto base", x: 95, width: 170 },
        { label: "Variante", x: 270, width: 110 },
        { label: "Preço", x: 385, width: 70 },
        { label: "Qtd.", x: 460, width: 40 },
        { label: "Total", x: 505, width: 70 },
      ]);
    }

    const y = doc.y;
    const total = new Decimal(product.preco).times(product.estoque);

    doc.text(product.codigo || "-", 30, y, { width: 60 });
    doc.text(product.ProdutoBase?.nome || product.nome, 95, y, { width: 170 });
    doc.text(getVariantName(product.nomeVariante), 270, y, { width: 110 });
    doc.text(formatarValorMonetario(new Decimal(product.preco)), 385, y, { width: 70, align: "right" });
    doc.text(String(product.estoque), 460, y, { width: 40, align: "right" });
    doc.text(formatarValorMonetario(total), 505, y, { width: 70, align: "right" });

    doc
      .moveTo(30, y + 14)
      .lineTo(575, y + 14)
      .strokeColor("#E5E7EB")
      .stroke();

    doc.y = y + 18;
  });
}

async function renderSalesOrProfitReport(
  doc: PDFKit.PDFDocument,
  params: {
    conta: {
      nome: string;
      nomeFantasia?: string | null;
      email?: string | null;
      categoria?: string | null;
      documento?: string | null;
      profile?: string | null;
    };
    report: ProductSalesReportData;
    mode: "vendas" | "lucro";
  }
) {
  const title =
    params.mode === "lucro" ? "Relatório de lucro por produto" : "Relatório de vendas por produto";

  await drawHeader(doc, params.conta, {
    title,
    subtitleLines: [
      `Produto base: ${params.report.produtoBase}`,
      `Variante: ${params.report.variante || "Todas as variantes do produto base"}`,
      `Período: ${params.report.periodo}`,
      `Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`,
    ],
  });

  drawMetricGrid(doc, [
    {
      label: "Receita bruta",
      value: formatarValorMonetario(params.report.receitaBruta),
      color: "#15803D",
    },
    {
      label: "Custo estimado",
      value: formatarValorMonetario(params.report.custoEstimado),
      color: "#B45309",
    },
    {
      label: params.mode === "lucro" ? "Lucro estimado" : "Ticket médio por venda",
      value:
        params.mode === "lucro"
          ? formatarValorMonetario(params.report.lucroEstimado)
          : formatarValorMonetario(params.report.ticketMedioVenda),
      color: params.mode === "lucro" ? "#2563EB" : "#7C3AED",
    },
    {
      label: params.mode === "lucro" ? "Margem estimada" : "Quantidade vendida",
      value:
        params.mode === "lucro"
          ? `${params.report.margemEstimada.toFixed(2)}%`
          : `${params.report.totalQuantidade}`,
      color: params.mode === "lucro" ? "#7C3AED" : "#2563EB",
    },
  ]);

  drawTableHeader(doc, [
    { label: "Data", x: 30, width: 55 },
    { label: "Venda", x: 88, width: 55 },
    { label: "Cliente", x: 146, width: 110 },
    { label: "Variante", x: 260, width: 95 },
    { label: "Qtd.", x: 358, width: 30 },
    { label: "Unit.", x: 392, width: 52 },
    { label: "Total", x: 448, width: 56 },
    { label: "Custo", x: 506, width: 56 },
    { label: "Lucro", x: 564, width: 36 },
  ]);

  params.report.rows.forEach((row) => {
    const lineHeight = 16;
    ensurePageSpace(doc, lineHeight + 10);

    if (doc.y === doc.page.margins.top) {
      drawTableHeader(doc, [
        { label: "Data", x: 30, width: 55 },
        { label: "Venda", x: 88, width: 55 },
        { label: "Cliente", x: 146, width: 110 },
        { label: "Variante", x: 260, width: 95 },
        { label: "Qtd.", x: 358, width: 30 },
        { label: "Unit.", x: 392, width: 52 },
        { label: "Total", x: 448, width: 56 },
        { label: "Custo", x: 506, width: 56 },
        { label: "Lucro", x: 564, width: 36 },
      ]);
    }

    const y = doc.y;
    doc.text(dayjs(row.data).format("DD/MM/YY"), 30, y, { width: 55 });
    doc.text(row.vendaUid || "-", 88, y, { width: 55 });
    doc.text(row.cliente, 146, y, { width: 110 });
    doc.text(row.variante, 260, y, { width: 95 });
    doc.text(String(row.quantidade), 358, y, { width: 30, align: "right" });
    doc.text(formatarValorMonetario(row.valorUnitario), 392, y, { width: 52, align: "right" });
    doc.text(formatarValorMonetario(row.totalVenda), 448, y, { width: 56, align: "right" });
    doc.text(formatarValorMonetario(row.custoTotal), 506, y, { width: 56, align: "right" });
    doc
      .fillColor(row.lucro.isNegative() ? "#B91C1C" : "#15803D")
      .text(formatarValorMonetario(row.lucro), 564, y, { width: 36, align: "right" });
    doc.fillColor("#111827");

    doc
      .moveTo(30, y + 14)
      .lineTo(595, y + 14)
      .strokeColor("#E5E7EB")
      .stroke();

    doc.y = y + 18;
  });

  drawFooterTotals(doc, [
    {
      label: "Receita bruta",
      value: formatarValorMonetario(params.report.receitaBruta),
      color: "#15803D",
    },
    {
      label: "Custo estimado",
      value: formatarValorMonetario(params.report.custoEstimado),
      color: "#B45309",
    },
    {
      label: "Lucro estimado",
      value: formatarValorMonetario(params.report.lucroEstimado),
      color: params.report.lucroEstimado.isNegative() ? "#B91C1C" : "#15803D",
    },
  ]);
}

export const relatorioProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const query = req.query;
  const contaId = getContaId(req);

  const inicio = parseOptionalDate(query.inicio);
  const fim = parseOptionalDate(query.fim);

  const produtos = await prisma.produto.findMany({
    where: {
      contaId,
      ...(inicio || fim
        ? {
            ProdutoBase: {
              createdAt: {
                ...(inicio ? { gte: inicio } : {}),
                ...(fim ? { lte: fim } : {}),
              },
            },
          }
        : {}),
    },
    include: {
      ProdutoBase: {
        select: {
          nome: true,
          createdAt: true,
        },
      },
    },
    orderBy: [
      {
        ProdutoBase: {
          createdAt: "desc",
        },
      },
      { nome: "asc" },
      { nomeVariante: "asc" },
    ],
  });

  const conta = await prisma.contas.findUnique({
    where: {
      id: contaId,
    },
  });

  if (!conta) {
    return ResponseHandler(
      res,
      "Erro na operação, faça login novamente e tente gerar outro relatório",
      null,
      404
    );
  }

  const doc = new PDFDocument({
    margin: 36,
    size: "A4",
    bufferPages: true,
    info: {
      Author: "Gestão Fácil",
      CreationDate: new Date(),
      Creator: "Gestão Fácil - ERP",
      Keywords: "ERP, Produtos, Estoque",
      Title: "Relatório de catálogo e estoque",
      Subject: "Relatório de catálogo e estoque por produto e variante",
      ModDate: new Date(),
    },
    pdfVersion: "1.4",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=relatorio-catalogo-produtos.pdf"
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  await renderCatalogReport(doc, {
    conta,
    products: produtos,
    periodo: getPeriodLabel(inicio, fim, "Todos os cadastros"),
  });

  doc.end();
};

export const relatorioVendasProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const contaId = getContaId(req);
    const targetType = String(req.query.targetType || "").toUpperCase() as ReportTargetType;
    const targetId = Number(req.query.targetId);
    const inicio = parseOptionalDate(req.query.inicio);
    const fim = parseOptionalDate(req.query.fim);

    if (!["BASE", "VARIANTE"].includes(targetType) || !targetId) {
      return ResponseHandler(
        res,
        "Informe targetType=BASE|VARIANTE e targetId válidos.",
        null,
        400
      );
    }

    const [conta, report] = await Promise.all([
      prisma.contas.findUnique({
        where: {
          id: contaId,
        },
      }),
      buildSalesReportData({
        contaId,
        targetType,
        targetId,
        inicio,
        fim,
      }),
    ]);

    if (!conta) {
      return ResponseHandler(res, "Conta não encontrada.", null, 404);
    }

    const doc = new PDFDocument({
      margin: 28,
      size: "A4",
      layout: "landscape",
      bufferPages: true,
      info: {
        Author: "Gestão Fácil",
        CreationDate: new Date(),
        Creator: "Gestão Fácil - ERP",
        Keywords: "ERP, Produtos, Vendas",
        Title: "Relatório de vendas por produto",
        Subject: "Relatório de vendas por produto base ou variante",
        ModDate: new Date(),
      },
      pdfVersion: "1.4",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=relatorio-vendas-produto-${targetType.toLowerCase()}-${targetId}.pdf`
    );
    doc.pipe(res);

    doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
    doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

    renderSalesOrProfitReport(doc, {
      conta,
      report,
      mode: "vendas",
    });

    doc.end();
  } catch (error: any) {
    return ResponseHandler(
      res,
      error?.message || "Erro ao gerar o relatório de vendas do produto.",
      null,
      500
    );
  }
};

export const relatorioLucroProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const contaId = getContaId(req);
    const targetType = String(req.query.targetType || "").toUpperCase() as ReportTargetType;
    const targetId = Number(req.query.targetId);
    const inicio = parseOptionalDate(req.query.inicio);
    const fim = parseOptionalDate(req.query.fim);

    if (!["BASE", "VARIANTE"].includes(targetType) || !targetId) {
      return ResponseHandler(
        res,
        "Informe targetType=BASE|VARIANTE e targetId válidos.",
        null,
        400
      );
    }

    const [conta, report] = await Promise.all([
      prisma.contas.findUnique({
        where: {
          id: contaId,
        },
      }),
      buildSalesReportData({
        contaId,
        targetType,
        targetId,
        inicio,
        fim,
      }),
    ]);

    if (!conta) {
      return ResponseHandler(res, "Conta não encontrada.", null, 404);
    }

    const doc = new PDFDocument({
      margin: 28,
      size: "A4",
      layout: "landscape",
      bufferPages: true,
      info: {
        Author: "Gestão Fácil",
        CreationDate: new Date(),
        Creator: "Gestão Fácil - ERP",
        Keywords: "ERP, Produtos, Lucro",
        Title: "Relatório de lucro por produto",
        Subject: "Relatório de lucro por produto base ou variante",
        ModDate: new Date(),
      },
      pdfVersion: "1.4",
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=relatorio-lucro-produto-${targetType.toLowerCase()}-${targetId}.pdf`
    );
    doc.pipe(res);

    doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
    doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

    await renderSalesOrProfitReport(doc, {
      conta,
      report,
      mode: "lucro",
    });

    doc.end();
  } catch (error: any) {
    return ResponseHandler(
      res,
      error?.message || "Erro ao gerar o relatório de lucro do produto.",
      null,
      500
    );
  }
};

export const relatorioProdutoMovimentacoes = async (
  req: Request,
  res: Response
): Promise<any> => {
  const orderBy = String(req.query.orderBy || "desc") === "asc" ? "asc" : "desc";
  const contaId = getContaId(req);

  const movimentos = await prisma.movimentacoesEstoque.findMany({
    where: {
      produtoId: Number(req.params.id),
      contaId,
    },
    orderBy: { data: orderBy },
    include: {
      Produto: {
        select: {
          nome: true,
          nomeVariante: true,
          ProdutoBase: {
            select: {
              nome: true,
            },
          },
        },
      },
    },
  });

  if (movimentos.length === 0) {
    return ResponseHandler(
      res,
      "Produto não encontrado ou sem movimentações",
      null,
      404
    );
  }

  const conta = await prisma.contas.findUnique({
    where: { id: contaId },
  });

  if (!conta) {
    return ResponseHandler(
      res,
      "Erro na operação, faça login novamente e tente gerar outro relatório",
      null,
      500
    );
  }

  const produtoRef = movimentos[0].Produto;
  const produtoBase = produtoRef?.ProdutoBase?.nome || produtoRef?.nome || "Produto";
  const variante = getVariantName(produtoRef?.nomeVariante);

  const doc = new PDFDocument({
    margin: 40,
    size: "A4",
    bufferPages: true,
    info: {
      Author: "Gestão Fácil",
      CreationDate: new Date(),
      Creator: "Gestão Fácil - ERP",
      Keywords: "ERP, Produtos, Estoque",
      Title: "Relatório de movimentações da variante",
      Subject: "Relatório de movimentações por variante",
      ModDate: new Date(),
    },
    pdfVersion: "1.4",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=relatorio-movimentacoes-variante-${req.params.id}.pdf`
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  await drawHeader(doc, conta, {
    title: "Relatório de movimentações da variante",
    subtitleLines: [
      `Produto base: ${produtoBase}`,
      `Variante: ${variante}`,
      `Ordenação: ${orderBy === "asc" ? "Mais antiga para mais nova" : "Mais nova para mais antiga"}`,
      `Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`,
    ],
  });

  drawTableHeader(doc, [
    { label: "Data", x: 30, width: 70 },
    { label: "Tipo", x: 105, width: 70 },
    { label: "Status", x: 180, width: 75 },
    { label: "Nota fiscal", x: 260, width: 115 },
    { label: "Qtd.", x: 380, width: 40 },
    { label: "Valor unit.", x: 425, width: 70 },
    { label: "Total", x: 500, width: 70 },
  ]);

  movimentos.forEach((movimento) => {
    ensurePageSpace(doc, 28);

    if (doc.y === doc.page.margins.top) {
      drawTableHeader(doc, [
        { label: "Data", x: 30, width: 70 },
        { label: "Tipo", x: 105, width: 70 },
        { label: "Status", x: 180, width: 75 },
        { label: "Nota fiscal", x: 260, width: 115 },
        { label: "Qtd.", x: 380, width: 40 },
        { label: "Valor unit.", x: 425, width: 70 },
        { label: "Total", x: 500, width: 70 },
      ]);
    }

    const y = doc.y;
    const valorUnitario = new Decimal(movimento.custo || 0);
    const total = valorUnitario.times(movimento.quantidade);

    doc.text(dayjs(movimento.data).format("DD/MM/YYYY"), 30, y, { width: 70 });
    doc.text(movimento.tipo, 105, y, { width: 70 });
    doc.text(movimento.status, 180, y, { width: 75 });
    doc.text(movimento.notaFiscal || "Sem nota fiscal", 260, y, { width: 115 });
    doc.text(String(movimento.quantidade), 380, y, { width: 40, align: "right" });
    doc.text(formatarValorMonetario(valorUnitario), 425, y, { width: 70, align: "right" });
    doc.text(formatarValorMonetario(total), 500, y, { width: 70, align: "right" });

    doc
      .moveTo(30, y + 14)
      .lineTo(575, y + 14)
      .strokeColor("#E5E7EB")
      .stroke();

    doc.y = y + 18;
  });

  const totalEntradas = movimentos
    .filter((item) => item.tipo === "ENTRADA")
    .reduce(
      (acc, item) => acc.plus(new Decimal(item.custo || 0).times(item.quantidade)),
      new Decimal(0)
    );
  const totalSaidas = movimentos
    .filter((item) => item.tipo === "SAIDA")
    .reduce(
      (acc, item) => acc.plus(new Decimal(item.custo || 0).times(item.quantidade)),
      new Decimal(0)
    );
  const lucroLiquido = totalSaidas.minus(totalEntradas);

  drawFooterTotals(doc, [
    {
      label: "Total entradas",
      value: formatarValorMonetario(totalEntradas),
      color: "#15803D",
    },
    {
      label: "Total saídas",
      value: formatarValorMonetario(totalSaidas),
      color: "#2563EB",
    },
    {
      label: "Saldo líquido",
      value: formatarValorMonetario(lucroLiquido),
      color: lucroLiquido.isNegative() ? "#B91C1C" : "#15803D",
    },
  ]);

  doc.end();
};

export const gerarEtiquetasProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const productId = Number(req.params.id);
  const quantidade = Number(req.query.quantidade) || undefined;

  if (isNaN(productId)) {
    return ResponseHandler(res, "ID inválido", null, 400);
  }

  try {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="barcodes_produto_${productId}.pdf"`
    );

    const pdfStream = await generateBarcodesStream(productId, quantidade);
    pdfStream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
