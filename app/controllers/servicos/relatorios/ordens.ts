import PDFDocument from "pdfkit";
import { Response } from "express";
import Decimal from "decimal.js";
import fs from "fs";

interface Item {
  itemName: string;
  tipo: "SERVICO" | "PRODUTO";
  quantidade: number;
  valor: Decimal;
}

interface OrdemServicoData {
  id: number;
  Uid: string;
  data: Date;
  descricao: string | null;
  descricaoCliente: string | null;
  Cliente: { nome: string };
  Contas: { nomeFantasia: string };
  ItensOrdensServico: Item[];
  desconto: Decimal;
  total?: Decimal;
  logoPath?: string; // Caminho da logo local
}

export async function gerarPdfOrdemServico(
  ordem: OrdemServicoData,
  res: Response
) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  // Configuração do response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=${ordem.Uid || "ordem-servico"}.pdf`
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Cabeçalho com logo e título
  if (ordem.logoPath) {
    const fileExists = fs.existsSync(`./public/${ordem.logoPath}`);
    doc.image(
      fileExists ? `./public/${ordem.logoPath}` : "./public/imgs/logo.png",
      50,
      40,
      { width: 80 }
    );
  }
  doc.fontSize(18).font("Helvetica-Bold").text("Ordem de Serviço", 150, 50);
  doc
    .fontSize(12)
    .font("Roboto")
    .text(`Número: ${ordem.Uid}`, 150, 75)
    .text(`Data: ${new Date(ordem.data).toLocaleDateString("pt-BR")}`, 150, 90);

  // Linha divisória
  doc.moveTo(50, 120).lineTo(550, 120).strokeColor("#888").stroke();

  // Informações principais
  doc.moveDown().fontSize(12);
  doc.text(`Empresa: ${ordem.Contas.nomeFantasia}`, 50, 140);
  doc.text(`Cliente: ${ordem.Cliente.nome}`, 50, 160);
  if (ordem.descricaoCliente)
    doc.text(`Descrição (cliente): ${ordem.descricaoCliente}`, 50, 180, {
      width: 500,
    });

  // Seção descrição técnica
  if (ordem.descricao) {
    doc.moveDown();
    doc.font("Roboto-Bold").text("Descrição Técnica:", 50, 220);
    doc.font("Roboto").text(ordem.descricao, { width: 500 });
  }

  const eixosX = [50, 260, 320, 390, 490];
  // Tabela de itens
  let tableTop = 280;
  doc.moveTo(50, tableTop).lineTo(550, tableTop).strokeColor("#000").stroke();

  doc
    .fontSize(12)
    .font("Roboto-Bold")
    .text("Item", eixosX[0], tableTop + 8)
    .text("Tipo", eixosX[1], tableTop + 8)
    .text("Qtd", eixosX[2], tableTop + 8, { width: 50, align: "right" })
    .text("Valor", eixosX[3], tableTop + 8, { width: 80, align: "right" })
    .text("Total", eixosX[4], tableTop + 8, { width: 50, align: "right" });

  tableTop += 25;
  doc.moveTo(50, tableTop).lineTo(550, tableTop).strokeColor("#000").stroke();

  let totalGeral = 0;
  doc.font("Roboto").fontSize(11);

  ordem.ItensOrdensServico.forEach((item, i) => {
    const y = tableTop + 10 + i * 20;
    const total = Number(item.quantidade) * Number(item.valor);
    totalGeral += total;

    doc
      .text(item.itemName, eixosX[0], y)
      .text(item.tipo, eixosX[1], y)
      .text(item.quantidade.toString(), eixosX[2], y, {
        width: 50,
        align: "right",
      })
      .text(`R$ ${Number(item.valor).toFixed(2)}`, eixosX[3], y, {
        width: 80,
        align: "right",
      })
      .text(`R$ ${total.toFixed(2)}`, eixosX[4], y, {
        width: 60,
        align: "right",
      });
  });

  const yFinal = tableTop + 10 + ordem.ItensOrdensServico.length * 20 + 20;
  doc.moveTo(50, yFinal).lineTo(550, yFinal).strokeColor("#000").stroke();

  // Resumo financeiro
  const desconto = Number(ordem.desconto);
  const valorFinal = totalGeral - desconto;

  doc.font("Roboto-Bold").text("Resumo Financeiro", 50, yFinal + 20);
  doc
    .font("Roboto")
    .text(`Subtotal: R$ ${totalGeral.toFixed(2)}`, 400, yFinal + 40, {
      align: "right",
    });
  doc.text(`Desconto: R$ ${desconto.toFixed(2)}`, 400, yFinal + 60, {
    align: "right",
  });
  doc
    .font("Roboto-Bold")
    .fontSize(13)
    .text(`Total: R$ ${valorFinal.toFixed(2)}`, 400, yFinal + 85, {
      align: "right",
    });

  // Rodapé
  doc
    .fontSize(9)
    .fillColor("#666")
    .text("Documento gerado automaticamente. não tem valor fiscal.", 50, 780, {
      align: "center",
      width: 500,
    });

  doc.end();
}
