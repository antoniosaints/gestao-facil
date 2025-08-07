import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatarValorMonetario } from "../../utils/formatters";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const gerarCupomPdf = async (
  req: Request,
  res: Response
): Promise<any> => {
  const vendaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  const conta = await prisma.contas.findUniqueOrThrow({
    where: { id: customData.contaId },
  });
  const venda = await prisma.vendas.findUnique({
    where: { id: vendaId },
    include: {
      cliente: true,
      vendedor: true,
      ItensVendas: {
        include: { produto: true },
      },
      PagamentoVendas: true,
    },
  });

  if (!venda) {
    return res.status(404).json({ message: "Venda não encontrada" });
  }

  const doc = new PDFDocument({
    size: [250, 600],
    margin: 10,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=cupom-venda-${venda.id}.pdf`
  );
  doc.pipe(res);
  doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
  doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");

  // Cabeçalho
  doc.fontSize(14).font("Roboto-Bold").text(conta.nome, {
    align: "center",
  });
  doc.fontSize(8).font("Roboto").text(conta.email, {
    align: "center",
  });
  doc
    .fontSize(8)
    .font("Roboto")
    .text(conta.documento || "N/A", {
      align: "center",
    });
  doc
    .fontSize(8)
    .font("Roboto")
    .text(conta.telefone || "N/A", {
      align: "center",
    });

  doc.moveDown(0.5);
  doc.text("_".repeat(63), { align: "center" });

  doc.image(`./public/${conta.profile}`, 15, 10, {
    fit: [40, 40],
  });

  doc
    .moveDown(0.3)
    .font("Roboto")
    .fontSize(9)
    .text(`Data: ${dayjs(venda.data).format("DD/MM/YYYY")}`)
    .text(`Venda Nº: ${venda.id}`)
    .text(`Cliente: ${venda.cliente?.nome || "N/A"}`)
    .text(`Vendedor: ${venda.vendedor?.nome || "N/A"}`)
    .text(`Garantia: ${venda.garantia || "N/A"}`);

  doc.moveDown(0.5);

  doc
    .fontSize(9)
    .font("Roboto-Bold")
    .text("Itens da Venda:", { underline: true });
  doc.moveDown(0.2);

  venda.ItensVendas.forEach((item: any) => {
    const total = new Decimal(item.valor).times(item.quantidade);
    doc
      .font("Roboto")
      .fontSize(8)
      .text(`${item.produto.nome.substring(0, 30)}`, { continued: false })
      .text(`${item.quantidade} x ${formatarValorMonetario(item.valor)}`, {
        continued: true,
      })
      .text(`${formatarValorMonetario(total)}`, { align: "right" });
    doc.moveDown(0.3);
  });
  doc.text("_".repeat(63), { align: "center" });

  // Totais
  doc
    .moveDown(0.2)
    .font("Roboto-Bold")
    .fontSize(10)
    .text(`TOTAL: ${formatarValorMonetario(venda.valor)}`, {
      align: "center",
    });

  // Pagamento
  if (venda.PagamentoVendas) {
    doc
      .moveDown(0.3)
      .font("Roboto")
      .fontSize(9)
      .text(`Pagamento via: ${venda.PagamentoVendas.metodo}`);
  }

  // Rodapé
  doc
    .moveDown(1)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text("Cupom não fiscal", { align: "center" })
    .text("Obrigado pela preferência!", { align: "center" });

  doc.text("-".repeat(80), { align: "center" });
  doc.end();
};
