import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../utils/prisma";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  endOfDay,
  endOfMonth,
  formatDate,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";
import { formatCurrency } from "../../utils/formatters";

type DREGroupedItem = {
  categoria: string;
  valor: Decimal;
};

type DREPayload = {
  receitas: DREGroupedItem[];
  despesas: DREGroupedItem[];
  totalReceitas: Decimal;
  totalDespesas: Decimal;
  lucro: Decimal;
};

function parseDrePeriodo(inicio?: unknown, fim?: unknown) {
  if (!inicio || !fim) return null;

  const dataInicio = startOfDay(new Date(String(inicio)));
  const dataFim = endOfDay(new Date(String(fim)));

  if (Number.isNaN(dataInicio.getTime()) || Number.isNaN(dataFim.getTime())) {
    return null;
  }

  return {
    inicio: dataInicio,
    fim: dataFim,
  };
}

function parseOptionalPeriodo(inicio?: unknown, fim?: unknown) {
  if (!inicio || !fim) return null;
  return parseDrePeriodo(inicio, fim);
}

function getDecimalValue(value: Decimal.Value | null | undefined) {
  return new Decimal(value || 0);
}

function getParcelaPagoValue(parcela: { valor?: Decimal.Value | null; valorPago?: Decimal.Value | null }) {
  return parcela.valorPago !== null && parcela.valorPago !== undefined
    ? getDecimalValue(parcela.valorPago)
    : getDecimalValue(parcela.valor);
}

async function getDreLogoPath(profile?: string | null) {
  return resolveRenderableImageSource(profile);
}

function serializeGroupedMap(map: Map<string, Decimal>) {
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([categoria, valor]) => ({ categoria, valor }));
}

async function buildDrePayload(contaId: number, inicio: Date, fim: Date): Promise<DREPayload> {
  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      vencimento: {
        gte: inicio,
        lte: fim,
      },
      lancamento: {
        contaId,
      },
    },
    select: {
      valor: true,
      lancamento: {
        select: {
          tipo: true,
          categoria: {
            select: {
              nome: true,
            },
          },
        },
      },
    },
    orderBy: [{ vencimento: "asc" }, { id: "asc" }],
  });

  const receitas = new Map<string, Decimal>();
  const despesas = new Map<string, Decimal>();
  let totalReceitas = new Decimal(0);
  let totalDespesas = new Decimal(0);

  for (const parcela of parcelas) {
    const nomeCategoria = parcela.lancamento.categoria?.nome ?? "Sem categoria";
    const valor = new Decimal(parcela.valor || 0);

    if (parcela.lancamento.tipo === "RECEITA") {
      const atual = receitas.get(nomeCategoria) ?? new Decimal(0);
      receitas.set(nomeCategoria, atual.plus(valor));
      totalReceitas = totalReceitas.plus(valor);
      continue;
    }

    const atual = despesas.get(nomeCategoria) ?? new Decimal(0);
    despesas.set(nomeCategoria, atual.plus(valor));
    totalDespesas = totalDespesas.plus(valor);
  }

  return {
    receitas: serializeGroupedMap(receitas),
    despesas: serializeGroupedMap(despesas),
    totalReceitas,
    totalDespesas,
    lucro: totalReceitas.minus(totalDespesas),
  };
}

async function drawDrePdfHeader(
  doc: any,
  conta: {
    nome: string;
    nomeFantasia?: string | null;
    documento?: string | null;
    profile?: string | null;
  } | null,
  inicio: Date,
  fim: Date,
  modelo: string
) {
  doc.image(await getDreLogoPath(conta?.profile), 40, 36, {
    fit: [58, 58],
  });

  doc
    .font("Roboto-Bold")
    .fontSize(20)
    .fillColor("#111827")
    .text(conta?.nomeFantasia || conta?.nome || "Conta", 112, 38, {
      width: 320,
    });

  doc
    .font("Roboto")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(conta?.nome || "", 112, 62, {
      width: 320,
    })
    .text(conta?.documento || "Documento não informado", 112, 76, {
      width: 320,
    });

  doc
    .font("Roboto-Bold")
    .fontSize(16)
    .fillColor("#111827")
    .text(`DRE financeiro - ${modelo}`, 40, 116);

  doc
    .font("Roboto")
    .fontSize(10)
    .fillColor("#6B7280")
    .text("Demonstração do resultado do exercício", 40, 138)
    .text(
      `Período: ${formatDate(inicio, "dd/MM/yyyy")} a ${formatDate(fim, "dd/MM/yyyy")}`,
      40,
      152
    )
    .text(`Emitido em ${formatDate(new Date(), "dd/MM/yyyy HH:mm")}`, 40, 166);

  doc.y = 200;
}

export const getDRELancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseDrePeriodo(req.query.inicio, req.query.fim);

  if (!periodo) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros válidos "inicio" e "fim".' });
  }

  const contaId = getCustomRequest(req).customData.contaId;
  const dre = await buildDrePayload(contaId, periodo.inicio, periodo.fim);

  res.json(dre);
};
export const getDRELancamentosPDF = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseDrePeriodo(req.query.inicio, req.query.fim);
  const customData = getCustomRequest(req).customData;

  if (!periodo) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros válidos "inicio" e "fim".' });
  }

  const [conta, dre] = await Promise.all([
    prisma.contas.findFirst({
      where: {
        id: customData.contaId,
      },
    }),
    buildDrePayload(customData.contaId, periodo.inicio, periodo.fim),
  ]);

  const inicio = formatDate(periodo.inicio, "yyyy-MM-dd");
  const fim = formatDate(periodo.fim, "yyyy-MM-dd");

  // Configuração do PDF
  const doc = new PDFDocument({
    margin: 50,
    size: "A4",
    layout: "portrait",
    bufferPages: true,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="dre_${inicio}_a_${fim}.pdf"`
  );

  doc.pipe(res);
  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Função para verificar se precisa de nova página
  const checkPageBreak = (doc: any, neededSpace: number) => {
    if (doc.y + neededSpace > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      return true;
    }
    return false;
  };

  // Função para desenhar linha horizontal
  const drawLine = (doc: any, y?: number) => {
    const currentY = y || doc.y;
    doc
      .moveTo(doc.page.margins.left, currentY)
      .lineTo(doc.page.width - doc.page.margins.right, currentY)
      .stroke();
  };

  // Função para formatar valor monetário
  const formatCurrency = (value: Decimal): string => {
    return value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  // Função para desenhar tabela
  const drawTable = (
    doc: any,
    data: any[],
    title: string,
    isReceita: boolean = true
  ) => {
    const startY = doc.y;
    const pageWidth = doc.page.width;
    const totalMargins = doc.page.margins.left + doc.page.margins.right;
    const availableWidth = pageWidth - totalMargins;

    // Larguras das colunas mais balanceadas
    const colWidths = {
      tipo: 40,
      planejamento: 220,
      debito: 80,
      credito: 80,
      saldo: 80,
      percent: 50,
    };

    // Calcular posição inicial para centralizar a tabela
    const totalTableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);
    const startX =
      doc.page.margins.left + (availableWidth - totalTableWidth) / 2;

    // Verificar se há espaço para o cabeçalho da tabela
    checkPageBreak(doc, 100);

    // Título da seção
    doc.fontSize(12).font("Roboto-Bold").text(title, startX, doc.y);

    doc.moveDown(0.5);

    // Cabeçalho da tabela
    const headerY = doc.y;
    doc.fontSize(10).font("Roboto-Bold");

    // Desenhar cabeçalhos
    let currentX = startX;

    doc.text("Tipo", currentX, headerY, {
      width: colWidths.tipo,
      align: "center",
    });
    currentX += colWidths.tipo;

    doc.text("Planejamento", currentX, headerY, {
      width: colWidths.planejamento,
      align: "left",
    });
    currentX += colWidths.planejamento;

    doc.text("Débito", currentX, headerY, {
      width: colWidths.debito,
      align: "right",
    });
    currentX += colWidths.debito;

    doc.text("Crédito", currentX, headerY, {
      width: colWidths.credito,
      align: "right",
    });
    currentX += colWidths.credito;

    doc.text("Saldo", currentX, headerY, {
      width: colWidths.saldo,
      align: "right",
    });
    currentX += colWidths.saldo;

    doc.text("%", currentX, headerY, {
      width: colWidths.percent,
      align: "right",
    });

    // Linha abaixo do cabeçalho
    doc.moveDown(0.3);
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + totalTableWidth, doc.y)
      .stroke();
    doc.moveDown(0.3);

    // Total da seção (receitas ou despesas)
    const total = isReceita ? dre.totalReceitas : dre.totalDespesas;

    // Linha de total da categoria
    if (data.length > 0) {
      checkPageBreak(doc, 20);

      let currentX = startX;
      const rowY = doc.y;

      doc.fontSize(10).font("Roboto-Bold");

      // Tipo
      doc.text(isReceita ? "R" : "D", currentX, rowY, {
        width: colWidths.tipo,
        align: "center",
      });
      currentX += colWidths.tipo;

      // Planejamento
      doc.text(
        `(${isReceita ? "+" : "-"})${title.toUpperCase()}`,
        currentX,
        rowY,
        { width: colWidths.planejamento, align: "left" }
      );
      currentX += colWidths.planejamento;

      // Débito
      doc.text(isReceita ? "0.00" : formatCurrency(total), currentX, rowY, {
        width: colWidths.debito,
        align: "right",
      });
      currentX += colWidths.debito;

      // Crédito
      doc.text(isReceita ? formatCurrency(total) : "0.00", currentX, rowY, {
        width: colWidths.credito,
        align: "right",
      });
      currentX += colWidths.credito;

      // Saldo
      doc.text(formatCurrency(total), currentX, rowY, {
        width: colWidths.saldo,
        align: "right",
      });
      currentX += colWidths.saldo;

      // Percentual
      doc.text("100%", currentX, rowY, {
        width: colWidths.percent,
        align: "right",
      });

      doc.moveDown(0.5);
    }

    // Itens da categoria
    data.forEach((item, index) => {
      checkPageBreak(doc, 20);

      let currentX = startX;
      const rowY = doc.y;

      doc.fontSize(10).font("Roboto");

      const percentage = item.valor.div(total).times(100);

      // Tipo
      doc.text(isReceita ? "R" : "D", currentX, rowY, {
        width: colWidths.tipo,
        align: "center",
      });
      currentX += colWidths.tipo;

      // Planejamento (nome da categoria)
      doc.text(item.categoria, currentX, rowY, {
        width: colWidths.planejamento,
        align: "left",
      });
      currentX += colWidths.planejamento;

      // Débito
      doc.text(isReceita ? "-" : formatCurrency(item.valor), currentX, rowY, {
        width: colWidths.debito,
        align: "right",
      });
      currentX += colWidths.debito;

      // Crédito
      doc.text(isReceita ? formatCurrency(item.valor) : "-", currentX, rowY, {
        width: colWidths.credito,
        align: "right",
      });
      currentX += colWidths.credito;

      // Saldo
      doc.text(formatCurrency(item.valor), currentX, rowY, {
        width: colWidths.saldo,
        align: "right",
      });
      currentX += colWidths.saldo;

      // Percentual
      doc.text(`${percentage.toFixed(2)}%`, currentX, rowY, {
        width: colWidths.percent,
        align: "right",
      });

      doc.moveDown(0.4);
    });

    doc.moveDown(0.5);
  };

  await drawDrePdfHeader(doc, conta, periodo.inicio, periodo.fim, "Modelo 01");

  // Desenhar tabelas
  if (dre.receitas.length > 0) {
    drawTable(doc, dre.receitas, "Receitas", true);
  }

  if (dre.despesas.length > 0) {
    drawTable(doc, dre.despesas, "Despesas", false);
  }

  // Totais e Lucro Líquido
  checkPageBreak(doc, 80);

  // Calcular posição centralizada para os totais
  const pageWidth = doc.page.width;
  const totalMargins = doc.page.margins.left + doc.page.margins.right;
  const availableWidth = pageWidth - totalMargins;

  const colWidths = {
    tipo: 40,
    planejamento: 220,
    debito: 80,
    credito: 80,
    saldo: 80,
    percent: 50,
  };

  const totalTableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);
  const startX = doc.page.margins.left + (availableWidth - totalTableWidth) / 2;

  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + totalTableWidth, doc.y)
    .stroke();
  doc.moveDown(0.5);

  // Totais
  let currentX = startX;
  let rowY = doc.y;

  doc.fontSize(10).font("Roboto-Bold");

  // Linha de totais
  doc.text("(+) Totais", currentX + colWidths.tipo, rowY, {
    width: colWidths.planejamento,
    align: "left",
  });
  currentX += colWidths.tipo + colWidths.planejamento;

  doc.text(formatCurrency(dre.totalDespesas), currentX, rowY, {
    width: colWidths.debito,
    align: "right",
  });
  currentX += colWidths.debito;

  doc.text(formatCurrency(dre.totalReceitas), currentX, rowY, {
    width: colWidths.credito,
    align: "right",
  });
  currentX += colWidths.credito;

  const saldoTotal = dre.totalReceitas.minus(dre.totalDespesas);
  doc.text(formatCurrency(saldoTotal.abs()), currentX, rowY, {
    width: colWidths.saldo,
    align: "right",
  });

  doc.moveDown(0.8);

  // Lucro Líquido
  currentX = startX;
  rowY = doc.y;

  doc.text("(=) Lucro líquido", currentX + colWidths.tipo, rowY, {
    width: colWidths.planejamento,
    align: "left",
  });
  currentX +=
    colWidths.tipo +
    colWidths.planejamento +
    colWidths.debito +
    colWidths.credito;

  const lucroFormatted = dre.lucro.isNegative()
    ? `-${formatCurrency(dre.lucro.abs())}`
    : formatCurrency(dre.lucro);

  doc.text(lucroFormatted, currentX, rowY, {
    width: colWidths.saldo,
    align: "right",
  });

  doc.end();
};
export const getDRELancamentosPDFV2 = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseDrePeriodo(req.query.inicio, req.query.fim);
  const customData = getCustomRequest(req).customData;

  if (!periodo) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros válidos "inicio" e "fim".' });
  }

  const [conta, groupedDre] = await Promise.all([
    prisma.contas.findUnique({
      where: {
        id: customData.contaId,
      },
    }),
    buildDrePayload(customData.contaId, periodo.inicio, periodo.fim),
  ]);

  const categoriaMap = new Map<string, { receita: Decimal; despesa: Decimal }>();

  groupedDre.receitas.forEach((item) => {
    const current = categoriaMap.get(item.categoria) ?? {
      receita: new Decimal(0),
      despesa: new Decimal(0),
    };
    current.receita = current.receita.plus(item.valor);
    categoriaMap.set(item.categoria, current);
  });

  groupedDre.despesas.forEach((item) => {
    const current = categoriaMap.get(item.categoria) ?? {
      receita: new Decimal(0),
      despesa: new Decimal(0),
    };
    current.despesa = current.despesa.plus(item.valor);
    categoriaMap.set(item.categoria, current);
  });

  const dre = {
    lancamentos: Array.from(categoriaMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([categoria, valores]) => ({
        categoria,
        receita: valores.receita,
        despesa: valores.despesa,
      })),
    totalReceitas: groupedDre.totalReceitas,
    totalDespesas: groupedDre.totalDespesas,
    lucro: groupedDre.lucro,
  };

  const inicio = formatDate(periodo.inicio, "yyyy-MM-dd");
  const fim = formatDate(periodo.fim, "yyyy-MM-dd");

  // Configuração do PDF
  const doc = new PDFDocument({
    margin: 50,
    size: "A4",
    layout: "portrait",
    bufferPages: true,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="dre-v2_${inicio}_a_${fim}.pdf"`
  );

  doc.pipe(res);
  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Função para verificar se precisa de nova página
  const checkPageBreak = (doc: any, neededSpace: number) => {
    if (doc.y + neededSpace > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      return true;
    }
    return false;
  };

  // Função para formatar valor monetário de forma mais compacta
  const formatCurrency = (value: Decimal): string => {
    const formatted = value.toFixed(2);
    // Para valores grandes, usar formatação mais compacta
    if (value.abs().gte(1000000)) {
      return (value.toNumber() / 1000000).toFixed(1) + "M";
    } else if (value.abs().gte(1000)) {
      return formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
    return formatted;
  };

  // Função para desenhar linha horizontal completa
  const drawFullLine = (doc: any, y?: number) => {
    const currentY = y || doc.y;
    doc
      .moveTo(doc.page.margins.left, currentY)
      .lineTo(doc.page.width - doc.page.margins.right, currentY)
      .stroke();
  };

  // Configuração das colunas
  const pageWidth = doc.page.width;
  const totalMargins = doc.page.margins.left + doc.page.margins.right;
  const availableWidth = pageWidth - totalMargins;

  // Ajustar larguras para caber na página A4
  const colWidths = {
    asterisco: 15,
    planejamento: 200,
    debito: 70,
    credito: 70,
    saldo: 70,
    percent: 45,
  };

  const totalTableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

  // Verificar se a tabela cabe na largura disponível
  const finalTableWidth = Math.min(totalTableWidth, availableWidth);
  const startX = doc.page.margins.left + (availableWidth - finalTableWidth) / 2;

  await drawDrePdfHeader(doc, conta, periodo.inicio, periodo.fim, "Modelo 02");

  // Cabeçalho da tabela única
  let currentX = startX;
  const headerY = doc.y;

  doc
    .fontSize(10) // Reduzir fonte do cabeçalho também
    .font("Roboto-Bold");

  doc.text("*", currentX, headerY, {
    width: colWidths.asterisco,
    align: "center",
  });
  currentX += colWidths.asterisco;

  doc.text("Planejamento", currentX, headerY, {
    width: colWidths.planejamento,
    align: "left",
  });
  currentX += colWidths.planejamento;

  doc.text("Débito", currentX, headerY, {
    width: colWidths.debito,
    align: "right",
  });
  currentX += colWidths.debito;

  doc.text("Crédito", currentX, headerY, {
    width: colWidths.credito,
    align: "right",
  });
  currentX += colWidths.credito;

  doc.text("Saldo", currentX, headerY, {
    width: colWidths.saldo,
    align: "right",
  });
  currentX += colWidths.saldo;

  doc.text("%", currentX, headerY, {
    width: colWidths.percent,
    align: "right",
  });

  // Linha abaixo do cabeçalho
  doc.moveDown(0.3);
  drawFullLine(doc);
  doc.moveDown(0.3);

  // Função para desenhar uma linha de item
  const drawItem = (
    doc: any,
    asterisco: string,
    nome: string,
    debito: string,
    credito: string,
    saldo: string,
    percentual: string,
    indent: boolean = false
  ) => {
    checkPageBreak(doc, 15);

    let currentX = startX;
    const rowY = doc.y;

    doc
      .fontSize(10) // Reduzir fonte para caber melhor
      .font("Roboto");

    // Asterisco
    doc.text(asterisco, currentX, rowY, {
      width: colWidths.asterisco,
      align: "center",
    });
    currentX += colWidths.asterisco;

    // Nome (com indentação se necessário) - truncar se muito longo
    const nomeText = indent ? `  ${nome}` : nome;
    const nomeToShow =
      nomeText.length > 35 ? nomeText.substring(0, 32) + "..." : nomeText;
    doc.text(nomeToShow, currentX, rowY, {
      width: colWidths.planejamento,
      align: "left",
    });
    currentX += colWidths.planejamento;

    // Débito
    doc.text(debito, currentX, rowY, {
      width: colWidths.debito,
      align: "right",
    });
    currentX += colWidths.debito;

    // Crédito
    doc.text(credito, currentX, rowY, {
      width: colWidths.credito,
      align: "right",
    });
    currentX += colWidths.credito;

    // Saldo
    doc.text(saldo, currentX, rowY, { width: colWidths.saldo, align: "right" });
    currentX += colWidths.saldo;

    // Percentual
    doc.text(percentual, currentX, rowY, {
      width: colWidths.percent,
      align: "right",
    });

    doc.moveDown(0.4);
  };

  // Calcular total geral para percentuais
  const totalGeral = dre.totalReceitas.plus(dre.totalDespesas);

  // Desenhar todas as despesas primeiro
  dre.lancamentos.forEach((row) => {
    const receita = formatCurrency(row.receita);
    const despesa = formatCurrency(row.despesa);
    const valorTotal = row.receita.plus(row.despesa);
    const percentual = totalGeral.isZero()
      ? "0.00%"
      : `${valorTotal.div(totalGeral).times(100).toFixed(2)}%`;
    const saldo = row.receita.minus(row.despesa);
    const valorFormatado = saldo.isNegative()
      ? `-${formatCurrency(saldo.abs())}`
      : formatCurrency(saldo);

    drawItem(
      doc,
      "*",
      row.categoria,
      despesa || "-",
      receita || "-",
      `${valorFormatado}`,
      percentual
    );
  });

  // Linha de separação antes dos totais
  doc.moveDown(0.2);
  drawFullLine(doc);
  doc.moveDown(0.3);

  // Totais
  const totalDespesasFormatado = formatCurrency(dre.totalDespesas);
  const totalReceitasFormatado = formatCurrency(dre.totalReceitas);
  const saldoTotal = dre.totalReceitas.minus(dre.totalDespesas);
  const saldoTotalFormatado = saldoTotal.isNegative()
    ? `-${formatCurrency(saldoTotal.abs())}`
    : formatCurrency(saldoTotal);

  doc
    .fontSize(9) // Manter consistência na fonte
    .font("Roboto-Bold");

  drawItem(
    doc,
    "(+)",
    "Totais",
    totalDespesasFormatado,
    totalReceitasFormatado,
    saldoTotalFormatado,
    ""
  );

  // Lucro líquido
  doc.moveDown(1);
  const lucroFormatado = dre.lucro.isNegative()
    ? `-${formatCurrency(dre.lucro.abs())}`
    : formatCurrency(dre.lucro);

  drawItem(doc, "(=)", "Lucro líquido", "", "", lucroFormatado, "");

  doc.end();
};

export const getParcelasAtrasadas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const hoje = new Date();
  const customData = getCustomRequest(req).customData;
  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      pago: false,
      vencimento: { lt: hoje },
      lancamento: {
        contaId: customData.contaId,
      },
    },
    include: {
      lancamento: {
        select: {
          descricao: true,
          cliente: { select: { nome: true } },
          categoria: { select: { nome: true } },
        },
      },
    },
  });

  res.json(
    parcelas.map((p) => ({
      id: p.id,
      numero: p.numero,
      valor: p.valor,
      vencimento: p.vencimento,
      cliente: p.lancamento.cliente?.nome || "Não informado",
      categoria: p.lancamento.categoria.nome,
      descricao: p.lancamento.descricao,
    }))
  );
};
export const getResumoPorCliente = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseOptionalPeriodo(req.query.inicio, req.query.fim);
  const customData = getCustomRequest(req).customData;

  const clientes = await prisma.clientesFornecedores.findMany({
    where: { contaId: customData.contaId },
    include: {
      LancamentoFinanceiro: {
        select: {
          tipo: true,
          parcelas: {
            where: periodo
              ? {
                  vencimento: {
                    gte: periodo.inicio,
                    lte: periodo.fim,
                  },
                }
              : undefined,
            select: {
              valor: true,
            },
          },
        },
      },
    },
  });

  const resultado = clientes.map((cliente) => {
    const totalReceitas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "RECEITA"
    ).reduce(
      (s, l) =>
        s.plus(
          l.parcelas.reduce((parcelasTotal, parcela) => parcelasTotal.plus(getDecimalValue(parcela.valor)), new Decimal(0))
        ),
      new Decimal(0)
    );

    const totalDespesas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "DESPESA"
    ).reduce(
      (s, l) =>
        s.plus(
          l.parcelas.reduce((parcelasTotal, parcela) => parcelasTotal.plus(getDecimalValue(parcela.valor)), new Decimal(0))
        ),
      new Decimal(0)
    );

    return {
      cliente: cliente.nome,
      receitas: totalReceitas,
      despesas: totalDespesas,
      saldo: totalReceitas.minus(totalDespesas),
    };
  });

  res.json(resultado);
};
export const getMediaMensalLancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const meses = Array.from({ length: 6 })
    .map((_, i) => {
      const mes = subMonths(new Date(), i);
      return {
        inicio: startOfMonth(mes),
        fim: endOfMonth(mes),
        label: mes.toLocaleDateString("pt-BR", {
          month: "short",
          year: "numeric",
        }),
      };
    })
    .reverse();

  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      vencimento: {
        gte: meses[0].inicio,
        lte: meses[meses.length - 1].fim,
      },
      lancamento: {
        contaId: customData.contaId,
      },
    },
    select: {
      valor: true,
      vencimento: true,
      lancamento: {
        select: {
          tipo: true,
        },
      },
    },
    orderBy: [{ vencimento: "asc" }, { id: "asc" }],
  });

  const resultado = meses.map((mes) => {
    const receitas = parcelas
      .filter(
        (parcela) =>
          parcela.lancamento.tipo === "RECEITA" &&
          parcela.vencimento >= mes.inicio &&
          parcela.vencimento <= mes.fim
      )
      .reduce((soma, parcela) => soma.plus(getDecimalValue(parcela.valor)), new Decimal(0));

    const despesas = parcelas
      .filter(
        (parcela) =>
          parcela.lancamento.tipo === "DESPESA" &&
          parcela.vencimento >= mes.inicio &&
          parcela.vencimento <= mes.fim
      )
      .reduce((soma, parcela) => soma.plus(getDecimalValue(parcela.valor)), new Decimal(0));

    return {
      mes: mes.label,
      receitas,
      despesas,
      saldo: receitas.minus(despesas),
    };
  });

  res.json(resultado);
};
export const getLancamentosPorConta = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { contaId } = getCustomRequest(req).customData;

  const contas = await prisma.contasFinanceiro.findMany({
    where: { contaId },
    include: {
      ParcelaFinanceiro: {
        include: { lancamento: true },
      },
    },
  });

  const resultado = contas.map((conta) => {
    const parcelas = conta.ParcelaFinanceiro;

    const receitas = parcelas.filter((p) => p.lancamento.tipo === "RECEITA");
    const despesas = parcelas.filter((p) => p.lancamento.tipo === "DESPESA");

    const sum = (items: typeof parcelas) =>
      items.reduce((s, p) => s.plus(getDecimalValue(p.valor)), new Decimal(0));

    const sumPago = (items: typeof parcelas) =>
      items
        .filter((p) => p.pago)
        .reduce((s, p) => s.plus(getParcelaPagoValue(p)), new Decimal(0));

    const totalReceitas = sum(receitas);
    const totalReceitasPago = sumPago(receitas);
    const totalDespesas = sum(despesas);
    const totalDespesasPago = sumPago(despesas);

    const saldoAtual = conta.saldoInicial
      .plus(totalReceitasPago)
      .minus(totalDespesasPago);

    return {
      conta: conta.nome,
      saldoInicial: conta.saldoInicial,
      receitas: totalReceitas,
      receitasPago: totalReceitasPago,
      despesas: totalDespesas,
      despesasPago: totalDespesasPago,
      saldoAtual,
    };
  });

  return res.json(resultado);
};

export const getLancamentosPorStatus = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseOptionalPeriodo(req.query.inicio, req.query.fim);
  const customData = getCustomRequest(req).customData;

  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      ...(periodo
        ? {
            vencimento: {
              gte: periodo.inicio,
              lte: periodo.fim,
            },
          }
        : {}),
      lancamento: {
        contaId: customData.contaId,
      },
    },
    select: {
      valor: true,
      valorPago: true,
      pago: true,
    },
  });

  const pendente = parcelas
    .filter((parcela) => !parcela.pago)
    .reduce((total, parcela) => total.plus(getDecimalValue(parcela.valor)), new Decimal(0));

  const pago = parcelas
    .filter((parcela) => parcela.pago)
    .reduce((total, parcela) => total.plus(getParcelaPagoValue(parcela)), new Decimal(0));

  res.json({ pendente, pago });
};
export const getLancamentosPorPagamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseOptionalPeriodo(req.query.inicio, req.query.fim);
  const customData = getCustomRequest(req).customData;

  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      pago: true,
      ...(periodo
        ? {
            dataPagamento: {
              gte: periodo.inicio,
              lte: periodo.fim,
            },
          }
        : {}),
      lancamento: {
        contaId: customData.contaId,
      },
    },
    select: {
      valor: true,
      valorPago: true,
      formaPagamento: true,
      lancamento: {
        select: {
          formaPagamento: true,
        },
      },
    },
  });

  const formas = new Map<string, Decimal>();

  parcelas.forEach((parcela) => {
    const formaPagamento = parcela.formaPagamento || parcela.lancamento.formaPagamento || "NÃO INFORMADO";
    const atual = formas.get(formaPagamento) ?? new Decimal(0);
    formas.set(formaPagamento, atual.plus(getParcelaPagoValue(parcela)));
  });

  res.json(
    Array.from(formas.entries()).map(([formaPagamento, valorTotal]) => ({
      formaPagamento,
      _sum: {
        valorTotal,
      },
    }))
  );
};
export const getLancamentosPorCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseOptionalPeriodo(req.query.inicio, req.query.fim);
  const { contaId } = getCustomRequest(req).customData;

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: { contaId },
    include: {
      lancamentos: {
        include: {
          parcelas: {
            where: periodo
              ? {
                  vencimento: {
                    gte: periodo.inicio,
                    lte: periodo.fim,
                  },
                }
              : undefined,
          },
        },
        select: {
          tipo: true,
          parcelas: true,
        },
      },
    },
  });

  const resultado = categorias.map((cat) => {
    const receitas = cat.lancamentos.filter((l) => l.tipo === "RECEITA");
    const despesas = cat.lancamentos.filter((l) => l.tipo === "DESPESA");

    const sumParcelas = (lancs: typeof cat.lancamentos) =>
      lancs.reduce(
        (soma, l) =>
          soma.plus(
            l.parcelas.reduce((ps, p) => ps.plus(getDecimalValue(p.valor)), new Decimal(0))
          ),
        new Decimal(0)
      );

    const totalReceita = sumParcelas(receitas);
    const totalDespesa = sumParcelas(despesas);

    return {
      categoria: cat.nome,
      totalReceita,
      totalDespesa,
      saldo: totalReceita.minus(totalDespesa),
    };
  });

  return res.json(resultado);
};

export const getLancamentosTotaisGerais = async (
  req: Request,
  res: Response
): Promise<any> => {
  const periodo = parseOptionalPeriodo(req.query.inicio, req.query.fim);
  const { contaId } = getCustomRequest(req).customData;

  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      pago: true,
      ...(periodo
        ? {
            dataPagamento: {
              gte: periodo.inicio,
              lte: periodo.fim,
            },
          }
        : {}),
      lancamento: {
        contaId,
      },
    },
    select: {
      valor: true,
      valorPago: true,
      lancamento: {
        select: {
          tipo: true,
        },
      },
    },
  });

  const totalReceitas = parcelas
    .filter((parcela) => parcela.lancamento.tipo === "RECEITA")
    .reduce((total, parcela) => total.plus(getParcelaPagoValue(parcela)), new Decimal(0));

  const totalDespesas = parcelas
    .filter((parcela) => parcela.lancamento.tipo === "DESPESA")
    .reduce((total, parcela) => total.plus(getParcelaPagoValue(parcela)), new Decimal(0));

  res.json({
    receitas: formatCurrency(totalReceitas),
    despesas: formatCurrency(totalDespesas),
    saldo: formatCurrency(totalReceitas.minus(totalDespesas)),
  });
};
