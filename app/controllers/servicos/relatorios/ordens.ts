import PDFDocument from "pdfkit";
import { Response } from "express";
import {
  ClientesFornecedores,
  Contas,
  ItensOrdensServico,
  OrdensServico,
  ParametrosConta,
  Usuarios,
} from "../../../../generated";
import { gerarQrCodeBuffer, QrCodePix } from "../../../services/qrcodeGenerator";
import { resolveRenderableImageSource } from "../../../services/uploads/fileStorageService";
import { formatCurrencyBR } from "../../../helpers/formatters";
import { addDays } from "date-fns";

interface OrdemServicoData {
  Cliente: ClientesFornecedores;
  Empresa: Contas & {
    ParametrosConta: ParametrosConta[];
  };
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
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });

  // Configuração do response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=${ordem.Ordem.Uid || "ordem-servico"}.pdf`
  );
  doc.pipe(res);

  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  const footerReserve = 36; // espaço reservado para o rodapé em cada página

  // Garante espaço vertical; se não houver, quebra a página mantendo a margem superior
  function ensureSpace(needed: number) {
    if (doc.y + needed > bottomLimit - footerReserve) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  }

  // Trunca o texto para caber em uma única linha na largura informada (com reticências),
  // evitando que nomes longos quebrem linha e sobreponham a linha seguinte da tabela.
  function fitText(texto: string, maxWidth: number, font: string, size: number) {
    doc.font(font).fontSize(size);
    if (doc.widthOfString(texto) <= maxWidth) return texto;
    let atual = texto;
    while (atual.length > 1 && doc.widthOfString(`${atual}…`) > maxWidth) {
      atual = atual.slice(0, -1);
    }
    return `${atual}…`;
  }

  // Cabeçalho (apenas na primeira página)
  try {
    const logoSource = await resolveRenderableImageSource(ordem.Empresa.profile);
    doc.image(logoSource, left, 40, { width: 80 });
  } catch {
    // logo indisponível — segue sem imagem
  }
  doc
    .fillColor("#111827")
    .fontSize(18)
    .font("Roboto-Bold")
    .text("Ordem de Serviço", 150, 50);
  doc
    .fillColor("#4B5563")
    .fontSize(12)
    .font("Roboto")
    .text(`ID da OS: ${ordem.Ordem.Uid}`, 150, 75)
    .text(
      `Data: ${new Date(ordem.Ordem.data).toLocaleDateString("pt-BR")}`,
      150,
      90
    );

  // Linha divisória
  doc.moveTo(left, 120).lineTo(right, 120).strokeColor("#888").stroke();

  // Informações principais (fluxo a partir da divisória)
  doc.y = 140;
  doc.fillColor("#111827").fontSize(12).font("Roboto");
  const infoLine = (texto: string) => {
    ensureSpace(24);
    doc.text(texto, left, doc.y, { width: contentWidth });
    doc.moveDown(0.4);
  };
  infoLine(
    `Empresa: ${ordem.Empresa.nome} - ${
      ordem.Empresa.documento || "Sem documento"
    }`
  );
  infoLine(
    `Cliente: ${ordem.Cliente.nome} - ${
      ordem.Cliente.documento || "Sem documento"
    }`
  );
  infoLine(
    `Garantia: ${ordem.Ordem.garantia} dias - ${addDays(new Date(ordem.Ordem.data), Number(ordem.Ordem.garantia || 0)).toLocaleDateString("pt-BR")}`
  );
  if (ordem.Ordem.descricaoCliente)
    infoLine(`Descrição (cliente): ${ordem.Ordem.descricaoCliente}`);

  // Seção descrição técnica
  if (ordem.Ordem.descricao) {
    doc.moveDown(0.4);
    ensureSpace(50);
    doc
      .font("Roboto-Bold")
      .text("Descrição Técnica:", left, doc.y, { width: contentWidth });
    doc.moveDown(0.2);
    doc
      .font("Roboto")
      .text(ordem.Ordem.descricao, left, doc.y, { width: contentWidth });
  }

  doc.moveDown(0.8);

  // Tabela de itens
  const eixosX = [left, 250, 320, 390, 485];
  const qtdW = 50;
  const valorW = 80;
  const totalW = right - eixosX[4];
  const rowHeight = 20;

  function drawItemsHeader() {
    const y = doc.y;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#000").stroke();
    doc
      .fillColor("#111827")
      .fontSize(12)
      .font("Roboto-Bold")
      .text("Item", eixosX[0], y + 8, {
        width: eixosX[1] - eixosX[0] - 6,
        ellipsis: true,
        lineBreak: false,
      })
      .text("Tipo", eixosX[1], y + 8, {
        width: eixosX[2] - eixosX[1] - 6,
        ellipsis: true,
        lineBreak: false,
      })
      .text("Qtd", eixosX[2], y + 8, { width: qtdW, align: "right" })
      .text("Valor", eixosX[3], y + 8, { width: valorW, align: "right" })
      .text("Total", eixosX[4], y + 8, { width: totalW, align: "right" });
    const lineY = y + 25;
    doc.moveTo(left, lineY).lineTo(right, lineY).strokeColor("#000").stroke();
    doc.y = lineY + 8;
  }

  ensureSpace(45 + rowHeight);
  drawItemsHeader();

  let totalGeral = 0;
  doc.font("Roboto").fontSize(11).fillColor("#111827");

  ordem.Ordem.ItensOrdensServico.forEach((item) => {
    if (doc.y + rowHeight > bottomLimit - footerReserve) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawItemsHeader();
      doc.font("Roboto").fontSize(11).fillColor("#111827");
    }

    const y = doc.y;
    const total = Number(item.quantidade) * Number(item.valor);
    totalGeral += total;

    const itemW = eixosX[1] - eixosX[0] - 6;
    const tipoW = eixosX[2] - eixosX[1] - 6;
    doc.font("Roboto").fontSize(11).fillColor("#111827");
    doc
      .text(fitText(item.itemName, itemW, "Roboto", 11), eixosX[0], y, {
        width: itemW,
        lineBreak: false,
      })
      .text(fitText(item.tipo, tipoW, "Roboto", 11), eixosX[1], y, {
        width: tipoW,
        lineBreak: false,
      })
      .text(item.quantidade.toString(), eixosX[2], y, {
        width: qtdW,
        align: "right",
      })
      .text(`${formatCurrencyBR(Number(item.valor))}`, eixosX[3], y, {
        width: valorW,
        align: "right",
      })
      .text(`${formatCurrencyBR(total)}`, eixosX[4], y, {
        width: totalW,
        align: "right",
      });
    doc.y = y + rowHeight;
  });

  const yFinal = doc.y + 6;
  doc.moveTo(left, yFinal).lineTo(right, yFinal).strokeColor("#000").stroke();
  doc.y = yFinal + 14;

  // Resumo financeiro
  ensureSpace(90);
  const desconto = Number(ordem.Ordem.desconto);
  const valorFinal = totalGeral - desconto;
  const resumoY = doc.y;
  const resumoX = eixosX[3] - 90;
  const resumoW = right - resumoX;

  doc
    .fillColor("#111827")
    .font("Roboto-Bold")
    .fontSize(12)
    .text("Resumo Financeiro", left, resumoY);
  doc
    .font("Roboto")
    .fontSize(12)
    .text(`Subtotal: ${formatCurrencyBR(totalGeral)}`, resumoX, resumoY, {
      width: resumoW,
      align: "right",
    })
    .text(`Desconto: ${formatCurrencyBR(desconto)}`, resumoX, resumoY + 18, {
      width: resumoW,
      align: "right",
    });
  doc
    .font("Roboto-Bold")
    .fontSize(13)
    .text(`Total: ${formatCurrencyBR(valorFinal)}`, resumoX, resumoY + 42, {
      width: resumoW,
      align: "right",
    });
  doc.y = resumoY + 72;

  // === Linhas de assinatura ===
  ensureSpace(60);
  const assinaturaY = doc.y + 30;

  doc
    .moveTo(80, assinaturaY)
    .lineTo(250, assinaturaY)
    .strokeColor("#000")
    .stroke();
  doc
    .fillColor("#111827")
    .font("Roboto")
    .fontSize(10)
    .text("Assinatura do Cliente", 80, assinaturaY + 5, {
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
  doc.y = assinaturaY + 40;

  // ============================================
  // 🔵 SEÇÃO OPCIONAL: PIX + QR CODE
  // ============================================

  if (
    incluirPix &&
    ordem.Empresa.ParametrosConta.length > 0 &&
    ordem.Empresa.ParametrosConta[0].chavePix
  ) {
    const qrSize = 90;
    const centerX = (doc.page.width - qrSize) / 2;

    const pix = QrCodePix({
      city: "Sao Mateus",
      key: ordem.Empresa.ParametrosConta[0].chavePix,
      name: ordem.Empresa.nome || "Gestão Facil",
      version: "01",
      value: valorFinal,
      message: `Ordem de Servico #${ordem.Ordem.id}`,
    });

    const qr = await gerarQrCodeBuffer(pix.payload());

    // Bloco de PIX inteiro em uma página (título + QR + payload)
    ensureSpace(qrSize + 90);
    doc.moveDown(1);
    doc
      .fillColor("#111827")
      .font("Roboto-Bold")
      .fontSize(14)
      .text("Pague via PIX", left, doc.y, { width: contentWidth, align: "center" });
    const qrY = doc.y + 8;
    doc.image(qr, centerX, qrY, { width: qrSize });
    doc.y = qrY + qrSize + 8;
    doc
      .font("Roboto")
      .fontSize(8)
      .fillColor("#4B5563")
      .text(pix.payload(), left, doc.y, {
        width: contentWidth,
        align: "center",
      });
  }

  // Rodapé em todas as páginas. É desenhado logo acima da linha da margem inferior
  // (dentro da faixa reservada por footerReserve): abaixo dela o pdfkit criaria uma
  // página automática, e o conteúdo nunca chega até aqui por causa do ensureSpace.
  const range = doc.bufferedPageRange();
  const footerY = bottomLimit - 14;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font("Roboto")
      .fontSize(9)
      .fillColor("#666")
      .text(
        "Documento gerado automaticamente via sistema Gestão Fácil - gestaofacil.userp.com.br.",
        left,
        footerY,
        {
          align: "center",
          width: contentWidth,
          lineBreak: false,
        }
      );
  }
  doc.flushPages();

  doc.end();
}
