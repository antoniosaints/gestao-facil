import PDFDocument from "pdfkit";
import { Response } from "express";
import fs from "fs";
import {
  ClientesFornecedores,
  Contas,
  ItensOrdensServico,
  OrdensServico,
  Usuarios,
} from "../../../../generated";
import { gerarQrCodeBuffer, QrCodePix } from "../../../services/qrcodeGenerator";

interface OrdemServicoData {
  Cliente: ClientesFornecedores;
  Empresa: Contas;
  Ordem: OrdensServico & {
    ItensOrdensServico: ItensOrdensServico[];
    Operador: Usuarios;
  };
}

export async function gerarPdfOrdemServico(
  ordem: OrdemServicoData,
  res: Response,
  incluirPix: boolean = false
) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  // Configuração do response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=${ordem.Ordem.Uid || "ordem-servico"}.pdf`
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Cabeçalho com logo e título
  if (ordem.Empresa.profile) {
    const fileExists = fs.existsSync(`./public/${ordem.Empresa.profile}`);
    doc.image(
      fileExists
        ? `./public/${ordem.Empresa.profile}`
        : "./public/imgs/logo.png",
      50,
      40,
      { width: 80 }
    );
  }
  doc.fontSize(18).font("Helvetica-Bold").text("Ordem de Serviço", 150, 50);
  doc
    .fontSize(12)
    .font("Roboto")
    .text(`ID da OS: ${ordem.Ordem.Uid}`, 150, 75)
    .text(
      `Data: ${new Date(ordem.Ordem.data).toLocaleDateString("pt-BR")}`,
      150,
      90
    );

  // Linha divisória
  doc.moveTo(50, 120).lineTo(550, 120).strokeColor("#888").stroke();

  // Informações principais
  doc.moveDown().fontSize(12);
  doc.text(
    `Empresa: ${ordem.Empresa.nome} - ${
      ordem.Empresa.documento || "Sem documento"
    }`,
    50,
    140
  );
  doc.text(
    `Cliente: ${ordem.Cliente.nome} - ${
      ordem.Cliente.documento || "Sem documento"
    }`,
    50,
    160
  );
  if (ordem.Ordem.descricaoCliente)
    doc.text(`Descrição (cliente): ${ordem.Ordem.descricaoCliente}`, 50, 180, {
      width: 500,
    });

  // Seção descrição técnica
  if (ordem.Ordem.descricao) {
    doc.moveDown();
    doc.font("Roboto-Bold").text("Descrição Técnica:", 50, 220);
    doc.font("Roboto").text(ordem.Ordem.descricao, { width: 500 });
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

  ordem.Ordem.ItensOrdensServico.forEach((item, i) => {
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

  const yFinal =
    tableTop + 10 + ordem.Ordem.ItensOrdensServico.length * 20 + 20;
  doc.moveTo(50, yFinal).lineTo(550, yFinal).strokeColor("#000").stroke();

  // Resumo financeiro
  const desconto = Number(ordem.Ordem.desconto);
  const valorFinal = totalGeral - desconto;

  doc.font("Roboto-Bold").text("Resumo Financeiro", 50, yFinal + 20);
  doc
    .font("Roboto")
    .text(`Subtotal: R$ ${totalGeral.toFixed(2)}`, 400, yFinal + 20, {
      align: "right",
    });
  doc.text(`Desconto: R$ ${desconto.toFixed(2)}`, 400, yFinal + 40, {
    align: "right",
  });
  doc
    .font("Roboto-Bold")
    .fontSize(13)
    .text(`Total: R$ ${valorFinal.toFixed(2)}`, 400, yFinal + 65, {
      align: "right",
    });

  // === Linhas de assinatura ===
  const assinaturaY = yFinal + 180;

  doc
    .moveTo(80, assinaturaY)
    .lineTo(250, assinaturaY)
    .strokeColor("#000")
    .stroke();
  doc.fontSize(10).text("Assinatura do Cliente", 80, assinaturaY + 5, {
    width: 170,
    align: "center",
  });

  doc
    .moveTo(330, assinaturaY)
    .lineTo(500, assinaturaY)
    .strokeColor("#000")
    .stroke();
  doc.fontSize(10).text("Assinatura do Técnico", 330, assinaturaY + 5, {
    width: 170,
    align: "center",
  });

  // Nomes abaixo das linhas
  doc
    .fontSize(9)
    .fillColor("#555")
    .text(`${ordem.Cliente.nome}`, 80, assinaturaY + 25, {
      width: 170,
      align: "center",
    });

  doc
    .fontSize(9)
    .fillColor("#555")
    .text(
      `${ordem.Ordem.Operador?.nome || "Técnico Responsável"}`,
      330,
      assinaturaY + 25,
      {
        width: 170,
        align: "center",
      }
    );

  // ============================================
  // 🔵 SEÇÃO OPCIONAL: PIX + QR CODE
  // ============================================

  if (incluirPix) {
    const qrSize = 90;

    const centerX = (doc.page.width - qrSize) / 2;
    const centerY = (doc.page.height - qrSize) / 2;

    const pix = QrCodePix({
      city: "Sao Mateus",
      key: "07418262329",
      name: "Arena ERP",
      version: "01",
    });

    const qr = await gerarQrCodeBuffer(pix.payload());

    // doc.addPage();

    doc.moveDown(1);
    doc
      .font("Roboto-Bold")
      .fontSize(14)
      .text("Pague via PIX", 50, assinaturaY + 50, { align: "center" });
    doc.image(qr, centerX, assinaturaY + 70, { width: qrSize });

    doc.moveDown(1);
    doc
      .font("Roboto")
      .fontSize(8)
      .text(pix.payload(), 60, assinaturaY + 160, { align: "center" });
  }

  // Rodapé
  doc
    .fontSize(9)
    .fillColor("#666")
    .text(
      "Documento gerado automaticamente via sistema Gestão Fácil - gestaofacil.userp.com.br.",
      50,
      780,
      {
        align: "center",
        width: 500,
      }
    );

  doc.end();
}
