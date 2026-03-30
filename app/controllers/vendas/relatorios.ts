import fs from "node:fs";
import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import { endOfDay, format, startOfDay } from "date-fns";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { formatCurrency } from "../../utils/formatters";
import { hasPermission } from "../../helpers/userPermission";

type TotaisStatus = {
  quantidade: number;
  valor: Decimal;
};

type ResumoRelatorioVendas = {
  periodo: {
    inicio: Date;
    fim: Date;
  };
  totais: {
    quantidadeVendas: number;
    clientesAtendidos: number;
    ticketMedio: Decimal;
    valorVendas: Decimal;
    valorCancelado: Decimal;
    custoEstimado: Decimal;
    lucroBrutoEstimado: Decimal;
    margemBrutaPercentual: Decimal;
  };
  status: {
    faturado: TotaisStatus;
    pendente: TotaisStatus;
    emAberto: TotaisStatus;
    cancelado: TotaisStatus;
  };
  cobrancas: {
    quantidade: number;
    recebido: Decimal;
    aReceber: Decimal;
    cancelado: Decimal;
    estornado: Decimal;
  };
  financeiro: {
    receitas: Decimal;
    despesas: Decimal;
    resultadoLiquido: Decimal;
    lucroLiquido: Decimal;
    prejuizo: Decimal;
  };
};

function parsePeriodo(inicio?: unknown, fim?: unknown) {
  const dataInicio = new Date(String(inicio ?? ""));
  const dataFim = new Date(String(fim ?? ""));

  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) {
    return null;
  }

  return {
    inicio: startOfDay(dataInicio),
    fim: endOfDay(dataFim),
  };
}

function createStatusBucket(): TotaisStatus {
  return {
    quantidade: 0,
    valor: new Decimal(0),
  };
}

function decimalMax(value: Decimal, min = 0) {
  return Decimal.max(value, new Decimal(min));
}

function decimalAbs(value: Decimal) {
  return value.isNegative() ? value.abs() : value;
}

async function buildResumoRelatorioVendas(
  contaId: number,
  inicio: Date,
  fim: Date,
): Promise<ResumoRelatorioVendas> {
  const [vendas, lancamentos] = await Promise.all([
    prisma.vendas.findMany({
      where: {
        contaId,
        data: {
          gte: inicio,
          lte: fim,
        },
      },
      include: {
        cliente: {
          select: {
            id: true,
          },
        },
        ItensVendas: {
          include: {
            produto: {
              select: {
                precoCompra: true,
                custoMedioProducao: true,
              },
            },
          },
        },
        CobrancasFinanceiras: {
          select: {
            status: true,
            valor: true,
          },
        },
      },
    }),
    prisma.lancamentoFinanceiro.findMany({
      where: {
        contaId,
        dataLancamento: {
          gte: inicio,
          lte: fim,
        },
      },
      select: {
        valorTotal: true,
        tipo: true,
      },
    }),
  ]);

  const resumo: ResumoRelatorioVendas = {
    periodo: { inicio, fim },
    totais: {
      quantidadeVendas: vendas.length,
      clientesAtendidos: 0,
      ticketMedio: new Decimal(0),
      valorVendas: new Decimal(0),
      valorCancelado: new Decimal(0),
      custoEstimado: new Decimal(0),
      lucroBrutoEstimado: new Decimal(0),
      margemBrutaPercentual: new Decimal(0),
    },
    status: {
      faturado: createStatusBucket(),
      pendente: createStatusBucket(),
      emAberto: createStatusBucket(),
      cancelado: createStatusBucket(),
    },
    cobrancas: {
      quantidade: 0,
      recebido: new Decimal(0),
      aReceber: new Decimal(0),
      cancelado: new Decimal(0),
      estornado: new Decimal(0),
    },
    financeiro: {
      receitas: new Decimal(0),
      despesas: new Decimal(0),
      resultadoLiquido: new Decimal(0),
      lucroLiquido: new Decimal(0),
      prejuizo: new Decimal(0),
    },
  };

  const clientesIds = new Set<number>();
  let vendasAtivas = 0;

  for (const venda of vendas) {
    const valorVenda = new Decimal(venda.valor || 0);

    if (venda.cliente?.id) {
      clientesIds.add(venda.cliente.id);
    }

    if (venda.status === "CANCELADO") {
      resumo.status.cancelado.quantidade += 1;
      resumo.status.cancelado.valor = resumo.status.cancelado.valor.plus(valorVenda);
      resumo.totais.valorCancelado = resumo.totais.valorCancelado.plus(valorVenda);
    } else {
      resumo.totais.valorVendas = resumo.totais.valorVendas.plus(valorVenda);
      vendasAtivas += 1;

      if (venda.status === "FATURADO") {
        resumo.status.faturado.quantidade += 1;
        resumo.status.faturado.valor = resumo.status.faturado.valor.plus(valorVenda);
      } else if (venda.status === "PENDENTE") {
        resumo.status.pendente.quantidade += 1;
        resumo.status.pendente.valor = resumo.status.pendente.valor.plus(valorVenda);
      } else {
        resumo.status.emAberto.quantidade += 1;
        resumo.status.emAberto.valor = resumo.status.emAberto.valor.plus(valorVenda);
      }
    }

    if (venda.status !== "CANCELADO") {
      for (const item of venda.ItensVendas) {
        const quantidade = new Decimal(item.quantidade || 0);
        const custoUnitario = new Decimal(
          item.produto?.custoMedioProducao ?? item.produto?.precoCompra ?? 0,
        );

        resumo.totais.custoEstimado = resumo.totais.custoEstimado.plus(
          custoUnitario.mul(quantidade),
        );
      }
    }

    resumo.cobrancas.quantidade += venda.CobrancasFinanceiras.length;

    for (const cobranca of venda.CobrancasFinanceiras) {
      const valorCobranca = new Decimal(cobranca.valor || 0);

      if (["PAGO", "EFETIVADO"].includes(cobranca.status)) {
        resumo.cobrancas.recebido = resumo.cobrancas.recebido.plus(valorCobranca);
        continue;
      }

      if (["PENDENTE", "ATRASADO"].includes(cobranca.status)) {
        resumo.cobrancas.aReceber = resumo.cobrancas.aReceber.plus(valorCobranca);
        continue;
      }

      if (cobranca.status === "CANCELADO") {
        resumo.cobrancas.cancelado = resumo.cobrancas.cancelado.plus(valorCobranca);
        continue;
      }

      if (cobranca.status === "ESTORNADO") {
        resumo.cobrancas.estornado = resumo.cobrancas.estornado.plus(valorCobranca);
      }
    }
  }

  resumo.totais.clientesAtendidos = clientesIds.size;
  resumo.totais.ticketMedio = vendasAtivas
    ? resumo.totais.valorVendas.div(vendasAtivas)
    : new Decimal(0);
  resumo.totais.lucroBrutoEstimado = resumo.totais.valorVendas.minus(resumo.totais.custoEstimado);
  resumo.totais.margemBrutaPercentual = resumo.totais.valorVendas.gt(0)
    ? resumo.totais.lucroBrutoEstimado.div(resumo.totais.valorVendas).mul(100)
    : new Decimal(0);

  for (const lancamento of lancamentos) {
    const valorLancamento = new Decimal(lancamento.valorTotal || 0);

    if (lancamento.tipo === "RECEITA") {
      resumo.financeiro.receitas = resumo.financeiro.receitas.plus(valorLancamento);
      continue;
    }

    resumo.financeiro.despesas = resumo.financeiro.despesas.plus(valorLancamento);
  }

  resumo.financeiro.resultadoLiquido = resumo.financeiro.receitas.minus(
    resumo.financeiro.despesas,
  );
  resumo.financeiro.lucroLiquido = decimalMax(resumo.financeiro.resultadoLiquido, 0);
  resumo.financeiro.prejuizo = resumo.financeiro.resultadoLiquido.isNegative()
    ? decimalAbs(resumo.financeiro.resultadoLiquido)
    : new Decimal(0);

  return resumo;
}

function drawMetricCard(doc: PDFKit.PDFDocument, options: {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  value: string;
  subtitle?: string;
  accentColor?: string;
}) {
  const accentColor = options.accentColor || "#F97316";

  doc
    .roundedRect(options.x, options.y, options.width, options.height, 10)
    .fillAndStroke("#FFFFFF", "#E5E7EB");

  doc
    .save()
    .roundedRect(options.x, options.y, 5, options.height, 10)
    .fill(accentColor)
    .restore();

  doc
    .font("Roboto")
    .fontSize(9)
    .fillColor("#6B7280")
    .text(options.title, options.x + 16, options.y + 12, {
      width: options.width - 28,
    });

  doc
    .font("Roboto-Bold")
    .fontSize(15)
    .fillColor("#111827")
    .text(options.value, options.x + 16, options.y + 28, {
      width: options.width - 28,
    });

  if (options.subtitle) {
    doc
      .font("Roboto")
      .fontSize(8)
      .fillColor("#6B7280")
      .text(options.subtitle, options.x + 16, options.y + 50, {
        width: options.width - 28,
      });
  }
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y?: number) {
  const lineY = y ?? doc.y;

  doc
    .strokeColor("#E5E7EB")
    .lineWidth(1)
    .moveTo(40, lineY)
    .lineTo(doc.page.width - 40, lineY)
    .stroke();

  doc
    .font("Roboto-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text(title, 40, lineY + 12);

  doc.y = lineY + 34;
}

function drawInfoLine(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  accentColor = "#111827",
) {
  const currentY = doc.y;

  doc
    .font("Roboto")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(label, 40, currentY, {
      width: 260,
    });

  doc
    .font("Roboto-Bold")
    .fontSize(10)
    .fillColor(accentColor)
    .text(value, 320, currentY, {
      width: doc.page.width - 360,
      align: "right",
    });

  doc.y = currentY + 18;
}

function formatDecimalCurrency(value: Decimal) {
  return formatCurrency(value.toNumber());
}

export async function getLucroPorVendas(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const { inicio, fim } = req.query;
    const customData = getCustomRequest(req).customData;

    if (!(await hasPermission(customData, 3))) {
      return res.json({
        periodo: { inicio, fim },
        totais: {
          vendaTotal: 0,
          custoTotal: 0,
          lucroTotal: 0,
        },
      });
    }

    const periodo = parsePeriodo(inicio, fim);

    if (!periodo) {
      return res
        .status(400)
        .json({ erro: 'Parâmetros "inicio" e "fim" são obrigatórios.' });
    }

    const resumo = await buildResumoRelatorioVendas(
      customData.contaId,
      periodo.inicio,
      periodo.fim,
    );

    return res.json({
      periodo: {
        inicio,
        fim,
      },
      totais: {
        vendaTotal: resumo.totais.valorVendas.toNumber(),
        custoTotal: resumo.totais.custoEstimado.toNumber(),
        lucroTotal: resumo.totais.lucroBrutoEstimado.toNumber(),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro interno no servidor." });
  }
}

export async function getResumoVendasPDF(
  req: Request,
  res: Response,
): Promise<any> {
  try {
    const { inicio, fim } = req.query;
    const customData = getCustomRequest(req).customData;
    const periodo = parsePeriodo(inicio, fim);

    if (!periodo) {
      return res
        .status(400)
        .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
    }

    const [conta, resumo] = await Promise.all([
      prisma.contas.findUniqueOrThrow({
        where: {
          id: customData.contaId,
        },
      }),
      buildResumoRelatorioVendas(customData.contaId, periodo.inicio, periodo.fim),
    ]);

    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      bufferPages: true,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="relatorio-vendas_${format(periodo.inicio, "yyyy-MM-dd")}_a_${format(periodo.fim, "yyyy-MM-dd")}.pdf"`,
    );

    doc.pipe(res);
    doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
    doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

    const filePath = `./public/${conta.profile || "imgs/logo.png"}`;
    const fileExists = fs.existsSync(filePath);

    if (fileExists) {
      doc.image(filePath, 40, 36, {
        fit: [58, 58],
      });
    } else {
      doc.image("./public/imgs/logo.png", 40, 36, {
        fit: [58, 58],
      });
    }

    doc
      .font("Roboto-Bold")
      .fontSize(20)
      .fillColor("#111827")
      .text(conta.nomeFantasia || conta.nome, 112, 38, {
        width: 320,
      });

    doc
      .font("Roboto")
      .fontSize(10)
      .fillColor("#6B7280")
      .text(conta.nome, 112, 62, {
        width: 320,
      })
      .text(conta.documento || "Documento não informado", 112, 76, {
        width: 320,
      });

    doc
      .font("Roboto-Bold")
      .fontSize(16)
      .fillColor("#111827")
      .text("Relatório de vendas", 40, 116);

    doc
      .font("Roboto")
      .fontSize(10)
      .fillColor("#6B7280")
      .text(
        `Período: ${format(periodo.inicio, "dd/MM/yyyy")} até ${format(periodo.fim, "dd/MM/yyyy")}`,
        40,
        138,
      )
      .text(`Emitido em ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 40, 152);

    const pageWidth = doc.page.width - 80;
    const cardGap = 12;
    const cardWidth = (pageWidth - cardGap) / 2;
    const cardHeight = 78;
    const cardsY = 188;

    drawMetricCard(doc, {
      x: 40,
      y: cardsY,
      width: cardWidth,
      height: cardHeight,
      title: "Valor de vendas no período",
      value: formatDecimalCurrency(resumo.totais.valorVendas),
      subtitle: `${resumo.totais.quantidadeVendas} venda(s) registradas`,
      accentColor: "#0F766E",
    });
    drawMetricCard(doc, {
      x: 40 + cardWidth + cardGap,
      y: cardsY,
      width: cardWidth,
      height: cardHeight,
      title: "Faturado",
      value: formatDecimalCurrency(resumo.status.faturado.valor),
      subtitle: `${resumo.status.faturado.quantidade} venda(s) faturadas`,
      accentColor: "#15803D",
    });
    drawMetricCard(doc, {
      x: 40,
      y: cardsY + cardHeight + cardGap,
      width: cardWidth,
      height: cardHeight,
      title: "Pendente",
      value: formatDecimalCurrency(resumo.status.pendente.valor),
      subtitle: `${resumo.status.pendente.quantidade} venda(s) pendentes`,
      accentColor: "#CA8A04",
    });
    drawMetricCard(doc, {
      x: 40 + cardWidth + cardGap,
      y: cardsY + cardHeight + cardGap,
      width: cardWidth,
      height: cardHeight,
      title: "Em aberto",
      value: formatDecimalCurrency(resumo.status.emAberto.valor),
      subtitle: `${resumo.status.emAberto.quantidade} venda(s) abertas`,
      accentColor: "#2563EB",
    });

    doc.y = cardsY + cardHeight * 2 + cardGap + 24;

    drawSectionTitle(doc, "Resumo gerencial");
    drawInfoLine(doc, "Ticket médio", formatDecimalCurrency(resumo.totais.ticketMedio));
    drawInfoLine(doc, "Clientes atendidos", `${resumo.totais.clientesAtendidos}`);
    drawInfoLine(doc, "Valor cancelado", formatDecimalCurrency(resumo.totais.valorCancelado), "#B91C1C");
    drawInfoLine(doc, "Custo estimado dos itens", formatDecimalCurrency(resumo.totais.custoEstimado));
    drawInfoLine(
      doc,
      "Lucro bruto estimado",
      formatDecimalCurrency(resumo.totais.lucroBrutoEstimado),
      resumo.totais.lucroBrutoEstimado.isNegative() ? "#B91C1C" : "#15803D",
    );
    drawInfoLine(
      doc,
      "Margem bruta estimada",
      `${resumo.totais.margemBrutaPercentual.toFixed(2)}%`,
      resumo.totais.margemBrutaPercentual.isNegative() ? "#B91C1C" : "#15803D",
    );

    drawSectionTitle(doc, "Cobranças vinculadas às vendas");
    drawInfoLine(doc, "Cobranças geradas", `${resumo.cobrancas.quantidade}`);
    drawInfoLine(doc, "Recebido em cobranças", formatDecimalCurrency(resumo.cobrancas.recebido), "#15803D");
    drawInfoLine(doc, "A receber", formatDecimalCurrency(resumo.cobrancas.aReceber), "#CA8A04");
    drawInfoLine(doc, "Cancelado", formatDecimalCurrency(resumo.cobrancas.cancelado), "#B91C1C");
    drawInfoLine(doc, "Estornado", formatDecimalCurrency(resumo.cobrancas.estornado), "#7C3AED");

    drawSectionTitle(doc, "Visão financeira do período");
    drawInfoLine(doc, "Receitas lançadas", formatDecimalCurrency(resumo.financeiro.receitas), "#15803D");
    drawInfoLine(doc, "Despesas lançadas", formatDecimalCurrency(resumo.financeiro.despesas), "#B91C1C");
    drawInfoLine(
      doc,
      "Resultado líquido",
      formatDecimalCurrency(resumo.financeiro.resultadoLiquido),
      resumo.financeiro.resultadoLiquido.isNegative() ? "#B91C1C" : "#15803D",
    );
    drawInfoLine(doc, "Lucro líquido", formatDecimalCurrency(resumo.financeiro.lucroLiquido), "#15803D");
    drawInfoLine(doc, "Prejuízo", formatDecimalCurrency(resumo.financeiro.prejuizo), "#B91C1C");

    doc
      .font("Roboto")
      .fontSize(8)
      .fillColor("#6B7280")
      .text(
        "Observação: o lucro bruto estimado considera o custo dos produtos cadastrados nas vendas. O resultado líquido considera os lançamentos financeiros do período informado.",
        40,
        doc.y + 18,
        {
          width: doc.page.width - 80,
          align: "left",
        },
      );

    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ erro: "Erro ao gerar o relatório de vendas." });
  }
}
