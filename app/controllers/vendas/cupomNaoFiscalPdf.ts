import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatarValorMonetario } from "../../utils/formatters";

export const gerarCupomPdf = async (req: Request, res: Response): Promise<any> => {
  const vendaId = parseInt(req.params.id);

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

  doc.fontSize(12).font("Helvetica-Bold").text("GESTÃO FÁCIL ERP", {
    align: "center",
  });

  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(9);
  doc.text(`Data: ${dayjs(venda.data).format("DD/MM/YYYY HH:mm")}`);
  doc.text(`Venda Nº: ${venda.id}`);
  if (venda.cliente) doc.text(`Cliente: ${venda.cliente.nome}`);
  if (venda.vendedor) doc.text(`Vendedor: ${venda.vendedor.nome}`);

  doc.moveDown(0.5);
  doc.text("------------------------------------------");

  doc.font("Helvetica-Bold").text("Itens:");
  doc.font("Helvetica");

  venda.ItensVendas.forEach((item:any) => {
    const total = new Decimal(item.valor).times(item.quantidade);
    doc
      .fontSize(8)
      .text(
        `${item.produto.nome.substring(0, 25)}\n${
          item.quantidade
        } x ${formatarValorMonetario(item.valor)} = ${formatarValorMonetario(
          total
        )}`
      );
    doc.text("------------------------------------------");
  });

  doc.fontSize(10).font("Helvetica-Bold");
  doc.text(`TOTAL: ${formatarValorMonetario(venda.valor)}`, {
    align: "right",
  });

  if (venda.PagamentoVendas) {
    doc.fontSize(9).text(`Pagamento: ${venda.PagamentoVendas.metodo}`);
  }

  doc.moveDown(1);
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text("Cupom não fiscal - Obrigado pela preferência!", {
      align: "center",
    });

  doc.end();
};
