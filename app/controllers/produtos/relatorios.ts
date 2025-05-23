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
  doc.font("Roboto").fontSize(12);

  // Cabeçalho
  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .text(`Relatório de Produtos - ${conta.nome}`, { align: "center" });
  doc
    .font("Roboto")
    .fontSize(10)
    .text(
      `E-mail: ${conta.email} | Categoria: ${
        conta.categoria || "Sem categoria"
      }`,
      {
        align: "center",
      }
    );
  doc.text(`Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`, {
    align: "center",
  });
  doc.moveDown(2);

  // Configuração da Tabela
  const tableTop = doc.y;
  const rowHeight = 20;
  const colX = { id: 30, nome: 60, preco: 420, estoque: 480, total: 510 };

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
  doc.font("Roboto").fontSize(8);

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
    return ResponseHandler(res, "Erro na operação, faça login novamente e tente gerar outro relatório", null, 500);
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

  // Cabeçalho
  doc
    .font("Roboto-Bold")
    .fontSize(18)
    .text(`Relatório de Reposição - ${movimentos[0].Produto.nome}`, {
      align: "center",
    });
  doc
    .font("Roboto")
    .fontSize(10)
    .text(
      `E-mail: ${conta.email} | Categoria: ${
        conta.categoria || "Sem categoria"
      }`,
      {
        align: "center",
      }
    );
  doc.text(`Emitido em: ${dayjs().format("DD/MM/YYYY HH:mm:ss")}`, {
    align: "center",
  });
  doc.moveDown(2);

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
  doc.font("Roboto").fontSize(8);

  movimentos.forEach((p) => {
    const valorUnitario = new Decimal(p.custo);
    const total = valorUnitario.times(p.quantidade);

    // Salva posição antes de desenhar nome
    const nomeY = y;
    doc.text(p.notaFiscal || "SEM NOTA FISCAL", colX.notaFiscal, nomeY, {
      width: colX.preco - colX.notaFiscal - 10,
      lineBreak: true,
    });

    // Calcula altura usada
    const nomeAltura = doc.heightOfString(p.Produto.nome, {
      width: colX.preco - colX.notaFiscal - 10,
    });

    // Escreve os demais campos alinhados no topo da linha
    doc
      .text(`# ${p.id.toString()}`, colX.id, nomeY)
      .text(p.status, colX.status, nomeY)
      .text(p.tipo, colX.tipo, nomeY)
      .text(dayjs(p.data).format("DD/MM/YYYY"), colX.data, nomeY)
      .text(`${formatarValorMonetario(valorUnitario)}`, colX.preco, nomeY)
      .text(p.quantidade.toString(), colX.estoque, nomeY)
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

export const gerarEtiquetasProduto = async (req: Request, res: Response): Promise<any> => {
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
