import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { formatarValorMonetario } from "../../utils/formatters";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { generateBarcodesStream } from "../../services/barcodeService";
import { ResponseHandler } from "../../utils/response";
import fs from "node:fs";

export const relatorioProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const query = req.query;
  const customData = getCustomRequest(req).customData;
  const produtos = await prisma.produto.findMany({
    where: {
      contaId: customData.contaId,
    },
  });

  const conta = await prisma.contas.findUnique({
    where: {
      id: customData.contaId,
    },
  });

  if (!conta) {
    return res.status(404).json({
      status: 404,
      message:
        "Erro na operação, faça login novamente e tente gerar outro relatório",
      data: null,
    });
  }

  const doc = new PDFDocument({
    margin: 50,
    info: {
      Author: "Antonio Costa dos Santos",
      CreationDate: new Date(),
      Creator: "Gestão Fácil - ERP",
      Keywords: "ERP",
      Title: "Relatório de Produtos",
      Subject:
        "Relatório baseado em estoque dos produtos do sistema Gestão Fácil",
      ModDate: new Date(),
    },
    pdfVersion: "1.4",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=relatorio-produtos.pdf"
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");
  doc.font("Roboto").fontSize(query.fontSize ? Number(query.fontSize) : 12);

  // Cabeçalho
  // Coordenadas do topo
  const marginTop = 40;
  const marginLeft = 40;
  const imageWidth = 80;
  const imageHeight = 80;
  const textLeft = marginLeft + imageWidth + 20; // Espaço entre imagem e texto

  // Cabeçalho com imagem à esquerda e texto ao lado
  const fileExists = fs.existsSync(`./public/${conta.profile}`);
  doc.image(fileExists ? `./public/${conta.profile}` : "./public/imgs/logo.png", marginLeft, marginTop, {
    fit: [imageWidth, imageHeight],
  });

  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .text(`Relatório de Produtos - ${conta.nome}`, textLeft, marginTop);

  doc
    .font("Roboto")
    .fontSize(10)
    .text(
      `E-mail: ${conta.email} | Categoria: ${
        conta.categoria || "Sem categoria"
      }`,
      textLeft
    )
    .text(`Documento: ${conta.documento}`, textLeft)
    .text(`Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`, textLeft);

  doc.moveDown(2);

  const headerHeight = Math.max(imageHeight, doc.y - marginTop);

  doc.y = marginTop + headerHeight + 20;

  // Configuração da Tabela
  const tableTop = doc.y;
  const rowHeight = 20;
  const colX = { id: 30, nome: 110, preco: 375, estoque: 445, total: 485 };

  // Títulos
  doc
    .font("Roboto-Bold")
    .text("Codigo", colX.id, tableTop, {})
    .text("Produto", colX.nome, tableTop)
    .text("Preço (R$)", colX.preco, tableTop)
    .text("Qtd.", colX.estoque, tableTop)
    .text("Total (R$)", colX.total, tableTop);

  // Linhas
  let y = tableTop + rowHeight;
  doc.font("Roboto").fontSize(query.fontSize ? Number(query.fontSize) : 10);

  produtos.forEach((p, index) => {
    const valorUnitario = new Decimal(p.preco);
    const total = valorUnitario.times(p.estoque);

    // Altura estimada da linha
    const nomeAltura = doc.heightOfString(p.nome, {
      width: colX.preco - colX.nome - 10,
    });
    const linhaAltura = Math.max(rowHeight, nomeAltura + 5);

    // Se não couber na página, cria nova e redesenha cabeçalho
    if (y + linhaAltura > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = marginTop;

      // Cabeçalho da tabela na nova página
      doc
        .font("Roboto-Bold")
        .text("Id", colX.id, y)
        .text("Produto", colX.nome, y)
        .text("Preço (R$)", colX.preco, y)
        .text("Qtd.", colX.estoque, y)
        .text("Total (R$)", colX.total, y);

      y += rowHeight;
      doc.font("Roboto").fontSize(query.fontSize ? Number(query.fontSize) : 10);
    }

    // Conteúdo da linha
    doc.text(`# ${p.codigo}`, colX.id, y);
    doc.text(p.nome, colX.nome, y, {
      width: colX.preco - colX.nome - 5,
    });
    doc.text(formatarValorMonetario(valorUnitario), colX.preco, y);
    doc.text(p.estoque.toString(), colX.estoque, y);
    doc.text(formatarValorMonetario(total), colX.total, y);

    // Linha divisória
    doc
      .moveTo(30, y + linhaAltura - 5)
      .lineTo(580, y + linhaAltura - 5)
      .strokeColor("#ccc")
      .stroke();

    y += linhaAltura;
  });

  doc.end();
};
export const relatorioProdutoMovimentacoes = async (
  req: Request,
  res: Response
): Promise<any> => {
  const orderBy = (req.query.orderBy as any) || "asc";
  const customData = getCustomRequest(req).customData;

  const movimentos = await prisma.movimentacoesEstoque.findMany({
    where: {
      produtoId: parseInt(req.params.id),
      contaId: customData.contaId,
    },
    orderBy: { data: orderBy },
    include: {
      Produto: {
        select: { nome: true, preco: true },
      },
    },
  });

  if (movimentos.length === 0) {
    return res.status(404).json({
      status: 404,
      message: "Produto não encontrado ou sem movimentações",
      data: null,
    });
  }

  const conta = await prisma.contas.findUnique({
    where: { id: customData.contaId },
  });

  if (!conta) {
    return ResponseHandler(
      res,
      "Erro na operação, faça login novamente e tente gerar outro relatório",
      null,
      500
    );
  }

  const doc = new PDFDocument({
    margin: 50,
    info: {
      Author: "Antonio Costa dos Santos",
      CreationDate: new Date(),
      Creator: "Gestão Fácil - ERP",
      Keywords: "ERP",
      Title: "Relatório de Movimentações de Produtos",
      Subject:
        "Relatório baseado em estoque dos produtos do sistema Gestão Fácil",
      ModDate: new Date(),
    },
    pdfVersion: "1.4",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=relatorio-produtos.pdf"
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");
  doc.font("Roboto").fontSize(12);

  const marginTop = 40;
  const marginLeft = 40;
  const imageWidth = 80;
  const imageHeight = 80;
  const textLeft = marginLeft + imageWidth + 20;

  // Cabeçalho principal
  const fileExists = fs.existsSync(`./public/${conta.profile}`);
  doc.image(fileExists ? `./public/${conta.profile}` : `./public/imgs/logo.png`, marginLeft, marginTop, {
    fit: [imageWidth, imageHeight],
  });

  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .text(`Relatório - ${movimentos[0].Produto.nome}`, textLeft, marginTop);

  doc
    .font("Roboto")
    .fontSize(10)
    .text(
      `E-mail: ${conta.email} | Categoria: ${
        conta.categoria || "Sem categoria"
      }`,
      textLeft
    )
    .text(`Documento: ${conta.documento}`, textLeft)
    .text(`Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`, textLeft);

  doc.moveDown(2);
  const headerHeight = Math.max(imageHeight, doc.y - marginTop);
  doc.y = marginTop + headerHeight + 20;

  // Configuração da tabela
  const rowHeight = 20;
  const colX = {
    id: 30,
    notaFiscal: 60,
    status: 160,
    tipo: 230,
    data: 290,
    preco: 360,
    estoque: 440,
    total: 510,
  };

  function desenharCabecalhoTabela(y: number) {
    doc
      .font("Roboto-Bold")
      .text("Id", colX.id, y)
      .text("Nota Fiscal", colX.notaFiscal, y)
      .text("Status", colX.status, y)
      .text("Tipo", colX.tipo, y)
      .text("Data", colX.data, y)
      .text("Preço (R$)", colX.preco, y)
      .text("Qtd.", colX.estoque, y)
      .text("Total (R$)", colX.total, y);
  }

  let y = doc.y;
  const pageHeight = doc.page.height - doc.page.margins.bottom;

  // Cabeçalho inicial
  desenharCabecalhoTabela(y);
  y += rowHeight;
  doc.font("Roboto").fontSize(8);

  movimentos.forEach((p) => {
    const valorUnitario = new Decimal(p.custo);
    const total = valorUnitario.times(p.quantidade);

    const notaFiscalTexto = p.notaFiscal || "SEM NOTA FISCAL";
    const notaFiscalAltura = doc.heightOfString(notaFiscalTexto, {
      width: colX.preco - colX.notaFiscal - 10,
    });
    const linhaAltura = Math.max(rowHeight, notaFiscalAltura + 5);

    // Quebra de página
    if (y + linhaAltura > pageHeight) {
      doc.addPage();
      y = marginTop;
      desenharCabecalhoTabela(y);
      y += rowHeight;
      doc.font("Roboto").fontSize(8);
    }

    const nomeY = y;
    doc.text(`# ${p.id}`, colX.id, nomeY);
    doc.text(notaFiscalTexto, colX.notaFiscal, nomeY, {
      width: colX.preco - colX.notaFiscal - 10,
    });
    doc.text(p.status, colX.status, nomeY);
    doc.text(p.tipo, colX.tipo, nomeY);
    doc.text(dayjs(p.data).format("DD/MM/YYYY"), colX.data, nomeY);
    doc.text(formatarValorMonetario(valorUnitario), colX.preco, nomeY);
    doc.text(p.quantidade.toString(), colX.estoque, nomeY);
    doc.text(formatarValorMonetario(total), colX.total, nomeY);

    doc
      .moveTo(30, nomeY + linhaAltura - 5)
      .lineTo(580, nomeY + linhaAltura - 5)
      .strokeColor("#ccc")
      .stroke();

    y += linhaAltura;
  });

  // Função para imprimir totais com quebra de página
  function imprimirLinhaTotal(titulo: string, col1: string, col2: string) {
    if (y + rowHeight > pageHeight) {
      doc.addPage();
      y = marginTop;
    }
    doc
      .font("Roboto-Bold")
      .text(titulo, colX.preco, y)
      .text(col1, colX.estoque, y)
      .text(col2, colX.total, y);
    y += rowHeight;
  }

  const totalEntradas = movimentos
    .filter((p) => p.tipo === "ENTRADA")
    .reduce(
      (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
      new Decimal(0)
    );
  const totalQuantidadeEntradas = movimentos
    .filter((p) => p.tipo === "ENTRADA")
    .reduce((acc, p) => acc.plus(p.quantidade), new Decimal(0));

  const totalSaidas = movimentos
    .filter((p) => p.tipo === "SAIDA")
    .reduce(
      (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
      new Decimal(0)
    );
  const totalQuantidadeSaidas = movimentos
    .filter((p) => p.tipo === "SAIDA")
    .reduce((acc, p) => acc.plus(p.quantidade), new Decimal(0));

  const totalGeral = movimentos.reduce(
    (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
    new Decimal(0)
  );
  const totalQuantidadeGeral = movimentos.reduce(
    (acc, p) => acc.plus(p.quantidade),
    new Decimal(0)
  );

  const lucroLiquido = totalSaidas.minus(totalEntradas);

  imprimirLinhaTotal(
    "Total Entradas",
    totalQuantidadeEntradas.toString(),
    formatarValorMonetario(totalEntradas)
  );
  imprimirLinhaTotal(
    "Total Saídas",
    totalQuantidadeSaidas.toString(),
    formatarValorMonetario(totalSaidas)
  );
  imprimirLinhaTotal(
    "Total Geral",
    totalQuantidadeGeral.toString(),
    formatarValorMonetario(totalGeral)
  );
  imprimirLinhaTotal("Lucro Líquido", "", formatarValorMonetario(lucroLiquido));

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
