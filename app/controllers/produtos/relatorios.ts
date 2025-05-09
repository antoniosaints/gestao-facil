import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { formatarValorMonetario, formatCurrency } from "../../utils/formatters";
import Decimal from "decimal.js";

export const relatorioProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const produtos = await prisma.produto.findMany();

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
    .text("Relatório de Produtos - Gestão Fácil", { align: "center" });
  doc
    .font("Roboto")
    .fontSize(10)
    .text("E-mail: contato@empresa.com | Telefone: (11) 99999-9999", {
      align: "center",
    });
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
