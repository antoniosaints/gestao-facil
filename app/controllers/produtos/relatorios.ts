import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { formatCurrency } from "../../utils/formatters";

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
      Subject: "Relatório baseado em estoque dos produtos do sistema Gestão Fácil",
      ModDate: new Date()
    },
    pdfVersion: "1.4"
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=relatorio-produtos.pdf"
  );
  doc.pipe(res);

  // Cabeçalho
  doc.fontSize(18).text("Relatório de produtos", { align: "center" });
  doc
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
  const colX = { id: 40, nome: 80, preco: 300, estoque: 400, total: 500 };

  // Títulos
  doc
    .font("Helvetica-Bold")
    .text("Id", colX.id, tableTop)
    .text("Produto", colX.nome, tableTop)
    .text("Preço (R$)", colX.preco, tableTop)
    .text("Qtd.", colX.estoque, tableTop)
    .text("Total", colX.total, tableTop);

  // Linhas
  let y = tableTop + rowHeight;
  doc.font("Helvetica");

  produtos.forEach((p) => {
    const total = p.preco * p.estoque;

    doc
      .text(p.id.toString(), colX.id, y)
      .text(p.nome, colX.nome, y)
      .text(formatCurrency(p.preco).toString(), colX.preco, y)
      .text(p.estoque.toString(), colX.estoque, y)
      .text(formatCurrency(total).toString(), colX.total, y);

    // Desenha linha inferior
    doc
      .moveTo(30, y + rowHeight - 5)
      .lineTo(590, y + rowHeight - 5)
      .strokeColor("#aaa")
      .stroke();

    y += rowHeight;
  });

  doc.end();
};
