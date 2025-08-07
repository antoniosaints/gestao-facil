import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { formatarValorMonetario } from "../../utils/formatters";
import Decimal from "decimal.js";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { generateBarcodesStream } from "../../services/barcodeService";
import { ResponseHandler } from "../../utils/response";

export const relatorioProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const produtos = await prisma.produto.findMany();
  const customData = getCustomRequest(req).customData;
  const query = req.query;

  if (query.fontSize) {
  }

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
  doc.image(`./public/${conta.profile}`, marginLeft, marginTop, {
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
  const colX = { id: 30, nome: 60, preco: 300, estoque: 400, total: 470 };

  // Títulos
  doc
    .font("Roboto-Bold")
    .text("Id", colX.id, tableTop, {})
    .text("Produto", colX.nome, tableTop)
    .text("Preço (R$)", colX.preco, tableTop)
    .text("Qtd.", colX.estoque, tableTop)
    .text("Total (R$)", colX.total, tableTop);

  // Linhas
  let y = tableTop + rowHeight;
  doc.font("Roboto").fontSize(query.fontSize ? Number(query.fontSize) : 10);

  produtos.forEach((p) => {
    const valorUnitario = new Decimal(p.preco);
    const total = valorUnitario.times(p.estoque);

    // Salva posição antes de desenhar nome
    const nomeY = y;
    doc.text(p.nome, colX.nome, nomeY, {
      width: colX.preco - colX.nome - 10,
      lineBreak: true,
    });

    // Calcula altura usada
    const nomeAltura = doc.heightOfString(p.nome, {
      width: colX.preco - colX.nome - 10,
    });

    // Escreve os demais campos alinhados no topo da linha
    doc
      .text(`# ${p.id.toString()}`, colX.id, nomeY)
      .text(`${formatarValorMonetario(valorUnitario)}`, colX.preco, nomeY)
      .text(p.estoque.toString(), colX.estoque, nomeY)
      .text(`${formatarValorMonetario(total)}`, colX.total, nomeY);

    // Linha divisória
    const linhaInferior = nomeY + nomeAltura + 5;
    doc
      .moveTo(30, linhaInferior)
      .lineTo(580, linhaInferior)
      .strokeColor("#ccc")
      .stroke();

    y = linhaInferior + 5;
  });

  doc.end();
};
export const relatorioProdutoMovimentacoes = async (
  req: Request,
  res: Response
): Promise<any> => {
  const orderBy = (req.query.orderBy as any) || "asc";
  const movimentos = await prisma.movimentacoesEstoque.findMany({
    where: {
      produtoId: parseInt(req.params.id),
    },
    orderBy: {
      data: orderBy,
    },
    include: {
      Produto: {
        select: {
          nome: true,
          preco: true,
        },
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

  const customData = getCustomRequest(req).customData;

  const conta = await prisma.contas.findUnique({
    where: {
      id: customData.contaId,
    },
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
  const textLeft = marginLeft + imageWidth + 20; // Espaço entre imagem e texto

  // Cabeçalho
  doc.image(`./public/${conta.profile}`, marginLeft, marginTop, {
    fit: [imageWidth, imageHeight],
  });

  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .text(
      `Relatório - ${movimentos[0].Produto.nome}`,
      textLeft,
      marginTop
    );

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

  // Títulos
  doc
    .font("Roboto-Bold")
    .text("Id", colX.id, tableTop, {})
    .text("Nota Fiscal", colX.notaFiscal, tableTop)
    .text("Status", colX.status, tableTop)
    .text("Tipo", colX.tipo, tableTop)
    .text("Data", colX.data, tableTop)
    .text("Preço (R$)", colX.preco, tableTop)
    .text("Qtd.", colX.estoque, tableTop)
    .text("Total (R$)", colX.total, tableTop);

  // Linhas
  let y = tableTop + rowHeight;
  const pageHeight = doc.page.height - doc.page.margins.bottom;

  doc.font("Roboto").fontSize(8);

  movimentos.forEach((p) => {
    const valorUnitario = new Decimal(p.custo);
    const total = valorUnitario.times(p.quantidade);

    // Altura estimada da linha
    const nomeAltura = doc.heightOfString(p.Produto.nome, {
      width: colX.preco - colX.notaFiscal - 10,
    });
    const linhaAlturaTotal = nomeAltura + 10; // margem extra

    // Verifica se há espaço suficiente na página atual
    if (y + linhaAlturaTotal > pageHeight) {
      doc.addPage();
      y = doc.y;

      // Redesenha os títulos da tabela na nova página
      doc
        .font("Roboto-Bold")
        .text("Id", colX.id, y, {})
        .text("Nota Fiscal", colX.notaFiscal, y)
        .text("Status", colX.status, y)
        .text("Tipo", colX.tipo, y)
        .text("Data", colX.data, y)
        .text("Preço (R$)", colX.preco, y)
        .text("Qtd.", colX.estoque, y)
        .text("Total (R$)", colX.total, y);

      y += rowHeight;
      doc.font("Roboto").fontSize(8);
    }

    const nomeY = y;
    doc.text(p.notaFiscal || "SEM NOTA FISCAL", colX.notaFiscal, nomeY, {
      width: colX.preco - colX.notaFiscal - 10,
      lineBreak: true,
    });

    doc
      .text(`# ${p.id.toString()}`, colX.id, nomeY)
      .text(p.status, colX.status, nomeY)
      .text(p.tipo, colX.tipo, nomeY)
      .text(dayjs(p.data).format("DD/MM/YYYY"), colX.data, nomeY)
      .text(`${formatarValorMonetario(valorUnitario)}`, colX.preco, nomeY)
      .text(p.quantidade.toString(), colX.estoque, nomeY)
      .text(`${formatarValorMonetario(total)}`, colX.total, nomeY);

    const linhaInferior = nomeY + nomeAltura + 5;
    doc
      .moveTo(30, linhaInferior)
      .lineTo(580, linhaInferior)
      .strokeColor("#ccc")
      .stroke();

    y = linhaInferior + 5;
  });

  // Total Entradas
  const totalEntradas = movimentos
    .filter((p) => p.tipo === "ENTRADA")
    .reduce(
      (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
      new Decimal(0)
    );
  const totalQuantidadeEntradas = movimentos
    .filter((p) => p.tipo === "ENTRADA")
    .reduce((acc, p) => acc.plus(p.quantidade), new Decimal(0));

  doc
    .font("Roboto-Bold")
    .text("Total Entradas", colX.preco, y + 5)
    .text(`${totalQuantidadeEntradas}`, colX.estoque, y + 5)
    .text(`${formatarValorMonetario(totalEntradas)}`, colX.total, y + 5);

  doc
    .moveTo(colX.preco, y + 17)
    .lineTo(580, y + 17)
    .strokeColor("#ccc")
    .stroke();

  // Total Saídas
  const totalSaidas = movimentos
    .filter((p) => p.tipo === "SAIDA")
    .reduce(
      (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
      new Decimal(0)
    );

  const totalQuantidadeSaidas = movimentos
    .filter((p) => p.tipo === "SAIDA")
    .reduce((acc, p) => acc.plus(p.quantidade), new Decimal(0));
  doc
    .font("Roboto-Bold")
    .text("Total Saídas", colX.preco, y + 25)
    .text(`${totalQuantidadeSaidas}`, colX.estoque, y + 25)
    .text(`${formatarValorMonetario(totalSaidas)}`, colX.total, y + 25);

  doc
    .moveTo(colX.preco, y + 37)
    .lineTo(580, y + 37)
    .strokeColor("#ccc")
    .stroke();

  // Total Geral
  const totalGeral = movimentos.reduce(
    (acc, p) => acc.plus(new Decimal(p.custo).times(p.quantidade)),
    new Decimal(0)
  );
  const totalQuantidadeGeral = movimentos.reduce(
    (acc, p) => acc.plus(p.quantidade),
    new Decimal(0)
  );
  doc
    .font("Roboto-Bold")
    .text("Total Geral", colX.preco, y + 45)
    .text(`${totalQuantidadeGeral}`, colX.estoque, y + 45)
    .text(`${formatarValorMonetario(totalGeral)}`, colX.total, y + 45);

  doc
    .moveTo(colX.preco, y + 57)
    .lineTo(580, y + 57)
    .strokeColor("#ccc")
    .stroke();

  // Lucro Líquido
  const lucroLiquido = totalSaidas.minus(totalEntradas);
  doc
    .font("Roboto-Bold")
    .text("Lucro Líquido", colX.estoque, y + 65)
    .text(`${formatarValorMonetario(lucroLiquido)}`, colX.total, y + 65);

  doc
    .moveTo(colX.estoque, y + 77)
    .lineTo(580, y + 77)
    .strokeColor("#ccc")
    .stroke();

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
