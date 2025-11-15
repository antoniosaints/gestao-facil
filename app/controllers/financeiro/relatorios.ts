import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../../utils/prisma";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  addHours,
  endOfMonth,
  formatDate,
  startOfMonth,
  subMonths,
} from "date-fns";
import { formatCurrency } from "../../utils/formatters";

export const getDRELancamentos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;

  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
  }

  const filtro = {
    dataLancamento: {
      gte: new Date(inicio as string),
      lte: new Date(fim as string),
    },
  };

  const contaId = getCustomRequest(req).customData.contaId;

  // Buscar lançamentos filtrados diretamente
  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: {
      ...filtro,
      contaId,
    },
    select: {
      valorTotal: true,
      desconto: true,
      tipo: true,
      categoria: {
        select: {
          nome: true,
        },
      },
    },
  });

  const dre = {
    receitas: new Map<string, Decimal>(),
    despesas: new Map<string, Decimal>(),
    totalReceitas: new Decimal(0),
    totalDespesas: new Decimal(0),
    lucro: new Decimal(0),
  };

  for (const l of lancamentos) {
    const nomeCategoria = l.categoria?.nome ?? "Sem categoria";
    const valor = new Decimal(l.valorTotal);

    if (l.tipo === "RECEITA") {
      const atual = dre.receitas.get(nomeCategoria) ?? new Decimal(0);
      dre.receitas.set(nomeCategoria, atual.plus(valor));
      dre.totalReceitas = dre.totalReceitas.plus(valor);
    } else if (l.tipo === "DESPESA") {
      const atual = dre.despesas.get(nomeCategoria) ?? new Decimal(0);
      dre.despesas.set(nomeCategoria, atual.plus(valor));
      dre.totalDespesas = dre.totalDespesas.plus(valor);
    }
  }

  dre.lucro = dre.totalReceitas.minus(dre.totalDespesas);

  res.json({
    receitas: Array.from(dre.receitas.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    })),
    despesas: Array.from(dre.despesas.entries()).map(([categoria, valor]) => ({
      categoria,
      valor,
    })),
    totalReceitas: dre.totalReceitas,
    totalDespesas: dre.totalDespesas,
    lucro: dre.lucro,
  });
};
export const getDRELancamentosPDF = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;

  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
  }

  const filtro = {
    dataLancamento: {
      gte: new Date(inicio as string),
      lte: new Date(fim as string),
    },
  };

  const conta = await prisma.contas.findFirst({
    where: {
      id: customData.contaId,
    },
  });

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId: customData.contaId,
    },
    include: {
      lancamentos: {
        where: filtro,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });

  const dre = {
    receitas: [] as { categoria: string; valor: Decimal }[],
    despesas: [] as { categoria: string; valor: Decimal }[],
    totalReceitas: new Decimal(0),
    totalDespesas: new Decimal(0),
    lucro: new Decimal(0),
  };

  for (const cat of categorias) {
    let totalReceita = new Decimal(0);
    let totalDespesa = new Decimal(0);

    for (const l of cat.lancamentos) {
      if (l.tipo === "RECEITA") {
        totalReceita = totalReceita.plus(l.valorTotal);
      } else if (l.tipo === "DESPESA") {
        totalDespesa = totalDespesa.plus(l.valorTotal);
      }
    }

    if (!totalReceita.isZero()) {
      dre.receitas.push({ categoria: cat.nome, valor: totalReceita });
      dre.totalReceitas = dre.totalReceitas.plus(totalReceita);
    }

    if (!totalDespesa.isZero()) {
      dre.despesas.push({ categoria: cat.nome, valor: totalDespesa });
      dre.totalDespesas = dre.totalDespesas.plus(totalDespesa);
    }
  }

  dre.lucro = dre.totalReceitas.minus(dre.totalDespesas);

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

  // Cabeçalho do documento
  doc
    .fontSize(16)
    .font("Roboto-Bold")
    .text(`DRE - ${conta?.nome}`, { align: "center" });

  doc
    .fontSize(12)
    .font("Roboto")
    .text("Demonstração do resultado do exercício", { align: "center" });
  doc
    .fontSize(12)
    .font("Roboto")
    .text(
      `Período: ${formatDate(
        addHours(new Date(inicio as string), 3),
        "dd/MM/yyyy"
      )} a ${formatDate(addHours(new Date(fim as string), 3), "dd/MM/yyyy")}`,
      { align: "center" }
    );

  doc.moveDown(1);

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
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;

  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ erro: 'Informe os parâmetros "inicio" e "fim".' });
  }

  const filtro = {
    dataLancamento: {
      gte: new Date(inicio as string),
      lte: new Date(fim as string),
    },
  };

  const conta = await prisma.contas.findUnique({
    where: {
      id: customData.contaId,
    },
  });

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId: customData.contaId,
    },
    include: {
      lancamentos: {
        where: filtro,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });
  const dre = {
    lancamentos: [] as {
      categoria: string;
      receita: Decimal;
      despesa: Decimal;
    }[],
    totalReceitas: new Decimal(0),
    totalDespesas: new Decimal(0),
    lucro: new Decimal(0),
  };

  for (const cat of categorias) {
    const receita = new Decimal(
      cat.lancamentos
        .filter((l) => l.tipo === "RECEITA")
        .reduce((s, l) => s.plus(l.valorTotal), new Decimal(0))
    );
    const despesa = new Decimal(
      cat.lancamentos
        .filter((l) => l.tipo === "DESPESA")
        .reduce((s, l) => s.plus(l.valorTotal), new Decimal(0))
    );

    if (!receita.isZero() || !despesa.isZero()) {
      dre.lancamentos.push({ categoria: cat.nome, receita, despesa });
      dre.totalReceitas = dre.totalReceitas.plus(receita);
      dre.totalDespesas = dre.totalDespesas.plus(despesa);
    }
  }

  dre.lucro = dre.totalReceitas.minus(dre.totalDespesas);

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

  // Cabeçalho do documento
  doc
    .fontSize(16)
    .font("Roboto-Bold")
    .text(`DRE - ${conta?.nome}`, { align: "center" });

  doc
    .fontSize(12)
    .font("Roboto")
    .text("Demonstração do resultado do exercício", { align: "center" });
  doc
    .fontSize(12)
    .font("Roboto")
    .text(
      `Período: ${formatDate(
        addHours(new Date(inicio as string), 3),
        "dd/MM/yyyy"
      )} a ${formatDate(addHours(new Date(fim as string), 3), "dd/MM/yyyy")}`,
      { align: "center" }
    );

  doc.moveDown(1.5);

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
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const clientes = await prisma.clientesFornecedores.findMany({
    where: { contaId: customData.contaId },
    include: {
      LancamentoFinanceiro: {
        where: dataFilter,
        select: {
          valorTotal: true,
          tipo: true,
        },
      },
    },
  });

  const resultado = clientes.map((cliente) => {
    const receitas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "RECEITA"
    );
    const despesas = cliente.LancamentoFinanceiro.filter(
      (l) => l.tipo === "DESPESA"
    );

    const totalReceitas = receitas.reduce(
      (s, l) => s.plus(l.valorTotal),
      new Decimal(0)
    );
    const totalDespesas = despesas.reduce(
      (s, l) => s.plus(l.valorTotal),
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

  const resultado = [];

  for (const mes of meses) {
    const receitas = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "RECEITA",
        dataLancamento: {
          gte: mes.inicio,
          lte: mes.fim,
        },
      },
    });

    const despesas = await prisma.lancamentoFinanceiro.aggregate({
      _sum: { valorTotal: true },
      where: {
        contaId: customData.contaId,
        tipo: "DESPESA",
        dataLancamento: {
          gte: mes.inicio,
          lte: mes.fim,
        },
      },
    });

    resultado.push({
      mes: mes.label,
      receitas: receitas._sum.valorTotal || new Decimal(0),
      despesas: despesas._sum.valorTotal || new Decimal(0),
      saldo: new Decimal(receitas._sum.valorTotal || 0).minus(
        despesas._sum.valorTotal || 0
      ),
    });
  }

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
      items.reduce((s, p) => s.plus(p.valor), new Decimal(0));

    const sumPago = (items: typeof parcelas) =>
      items
        .filter((p) => p.pago)
        .reduce((s, p) => s.plus(p.valor), new Decimal(0));

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
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: { contaId: customData.contaId, ...dataFilter },
    include: { parcelas: true },
  });

  const receitas = lancamentos.filter((l) => l.tipo === "RECEITA");
  const despesas = lancamentos.filter((l) => l.tipo === "DESPESA");

  const totalPendenteReceitas = receitas
    .flatMap((l) =>
      l.parcelas.filter((p) => !p.pago).map((p) => p.valor as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));

  const totalPendenteDespesas = despesas
    .flatMap((l) =>
      l.parcelas.filter((p) => !p.pago).map((p) => p.valor as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));
  const totalPagoReceitas = receitas
    .flatMap((l) =>
      l.parcelas.filter((p) => p.pago).map((p) => p.valorPago as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));

  const totalPagoDespesas = despesas
    .flatMap((l) =>
      l.parcelas.filter((p) => p.pago).map((p) => p.valorPago as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));

  const pendente = totalPendenteDespesas.plus(totalPendenteReceitas);
  const pago = totalPagoDespesas.plus(totalPagoReceitas);

  res.json({ pendente: pendente, pago: pago });
};
export const getLancamentosPorPagamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const customData = getCustomRequest(req).customData;
  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const formas = await prisma.lancamentoFinanceiro.groupBy({
    by: ["formaPagamento"],
    where: { contaId: customData.contaId, ...dataFilter },
    _sum: { valorTotal: true },
  });

  res.json(formas);
};
export const getLancamentosPorCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { inicio, fim } = req.query;
  const { contaId } = getCustomRequest(req).customData;

  const dataFilter =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: { contaId },
    include: {
      lancamentos: {
        where: dataFilter,
        include: {
          parcelas: true, // usamos estas parcelas para o cálculo real
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
            l.parcelas.reduce((ps, p) => ps.plus(p.valor), new Decimal(0))
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
  const { inicio, fim } = req.query;
  const { contaId } = getCustomRequest(req).customData;

  const where: any =
    inicio && fim
      ? {
          dataLancamento: {
            gte: new Date(inicio as string),
            lte: new Date(fim as string),
          },
        }
      : {};

  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: { contaId, ...where },
    include: { parcelas: true },
  });

  const receitas = lancamentos.filter((l) => l.tipo === "RECEITA");
  const despesas = lancamentos.filter((l) => l.tipo === "DESPESA");

  const totalReceitas = receitas
    .flatMap((l) =>
      l.parcelas.filter((p) => p.pago).map((p) => p.valorPago as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));

  const totalDespesas = despesas
    .flatMap((l) =>
      l.parcelas.filter((p) => p.pago).map((p) => p.valorPago as Decimal)
    )
    .reduce((total, valor) => total.plus(valor), new Decimal(0));

  res.json({
    receitas: formatCurrency(totalReceitas),
    despesas: formatCurrency(totalDespesas),
    saldo: formatCurrency(totalReceitas.minus(totalDespesas)),
  });
};
