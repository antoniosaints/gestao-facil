import type { Request, Response } from "express";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { getOuriveAccess } from "../../services/ourive/access";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";
import { prisma } from "../../utils/prisma";

const db = prisma as any;
const currency = (value: unknown) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value || 0),
  );
const date = (value: unknown) =>
  value
    ? new Date(value as string).toLocaleDateString("pt-BR")
    : "Não informado";
const statusLabels: Record<string, string> = {
  RECEBIDA: "Recebida",
  ORCAMENTO: "Orçamento",
  AGUARDANDO_MATERIAL: "Aguardando material",
  PRONTA_PRODUCAO: "Pronta para produção",
  PRODUCAO: "Em produção",
  FINALIZADA: "Finalizada",
  REVISAO: "Em revisão",
  PRONTA_ENTREGA: "Pronta para entrega",
  ENTREGUE: "Entregue",
  RECUSADA: "Recusada",
  CANCELADA: "Cancelada",
};

async function canAccessOrder(
  contaId: number,
  userId: number,
  orderId: number,
) {
  const access = await getOuriveAccess({
    contaId,
    userId,
    email: "",
    permissao: "",
    contaStatus: "ATIVO",
  });
  if (
    !access.papeis.includes("OURIVE") ||
    access.capabilities.includes("CONFIGURAR")
  )
    return true;
  const assignments = await db.ouriveEtapaResponsavel.findMany({
    where: { usuarioId: userId },
    select: { etapaId: true },
  });
  const [stage, direct] = await Promise.all([
    db.ouriveEtapa.findFirst({
      where: {
        ordemOuriveId: orderId,
        id: { in: assignments.map((item: any) => item.etapaId) },
      },
      select: { id: true },
    }),
    db.ouriveOrdemResponsavel.findFirst({
      where: { ordemOuriveId: orderId, usuarioId: userId },
      select: { ordemOuriveId: true },
    }),
  ]);
  return Boolean(stage || direct);
}

export async function orderReceiptPdf(req: Request, res: Response) {
  const { contaId, userId } = getCustomRequest(req).customData;
  const orderId = Number(req.params.id);
  const format =
    String(req.query.formato || "A4").toUpperCase() === "CUPOM"
      ? "CUPOM"
      : "A4";
  const order = await db.ouriveOrdem.findFirst({
    where: { id: orderId, contaId },
  });
  if (!order)
    return res
      .status(404)
      .json({
        error: { code: "order_not_found", message: "Ordem não encontrada." },
      });
  if (!(await canAccessOrder(contaId, userId, order.id)))
    return res
      .status(403)
      .json({
        error: {
          code: "ourive_not_assigned",
          message: "Esta ordem não foi atribuída a você.",
        },
      });

  const [account, base, pieces, budgets, materials] = await Promise.all([
    prisma.contas.findUnique({
      where: { id: contaId },
      select: {
        nome: true,
        nomeFantasia: true,
        documento: true,
        telefone: true,
        email: true,
        endereco: true,
        profile: true,
      },
    }),
    prisma.ordensServico.findFirst({
      where: { id: order.ordemServicoId, contaId },
      include: { Cliente: true },
    }),
    db.ourivePeca.findMany({
      where: { ordemOuriveId: order.id },
      orderBy: { id: "asc" },
    }),
    db.ouriveOrcamento.findMany({
      where: { ordemOuriveId: order.id },
      orderBy: { versao: "desc" },
      take: 1,
    }),
    db.ouriveMaterial.findMany({
      where: { ordemOuriveId: order.id },
      orderBy: { id: "asc" },
    }),
  ]);
  if (!account || !base)
    return res
      .status(404)
      .json({
        error: {
          code: "order_not_found",
          message: "Dados da ordem não encontrados.",
        },
      });
  const pieceIds = pieces.map((piece: any) => piece.id);
  const productIds = materials
    .map((material: any) => material.produtoId)
    .filter(Boolean);
  const [photos, products] = await Promise.all([
    db.ourivePecaFoto.findMany({
      where: { pecaId: { in: pieceIds } },
      orderBy: { id: "asc" },
    }),
    prisma.produto.findMany({
      where: { contaId, id: { in: productIds } },
      select: { id: true, nome: true },
    }),
  ]);
  const budget = budgets[0];
  const services = Array.isArray(budget?.servicos) ? budget.servicos : [];
  const estimateHeight = Math.max(
    700,
    560 +
      pieces.length * 90 +
      photos.length * 165 +
      services.length * 22 +
      materials.length * 22,
  );
  const doc = new PDFDocument({
    size: format === "A4" ? "A4" : [226.77, estimateHeight],
    margin: format === "A4" ? 42 : 14,
    bufferPages: true,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ordem-${order.codigoRastreio}-${format.toLowerCase()}.pdf"`,
  );
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const ensureSpace = (height: number) => {
    if (doc.y + height <= doc.page.height - doc.page.margins.bottom) return;
    doc.addPage();
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;
  };
  const section = (title: string) => {
    ensureSpace(36);
    doc
      .moveDown(0.7)
      .font("Helvetica-Bold")
      .fontSize(format === "A4" ? 12 : 10)
      .fillColor("#111827")
      .text(title);
    doc
      .moveDown(0.25)
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor("#D1D5DB")
      .stroke();
    doc.moveDown(0.35);
  };
  const line = (label: string, value: unknown) => {
    ensureSpace(18);
    doc
      .font("Helvetica-Bold")
      .fontSize(format === "A4" ? 9 : 8)
      .fillColor("#374151")
      .text(`${label}: `, { continued: true });
    doc
      .font("Helvetica")
      .fillColor("#111827")
      .text(String(value ?? "Não informado"));
  };

  try {
    if (account.profile) {
      const logo = await resolveRenderableImageSource(account.profile);
      doc.image(logo, left, doc.y, {
        fit: format === "A4" ? [70, 55] : [45, 38],
        align: "left",
      });
    }
  } catch {
    // O comprovante continua válido quando a logo cadastrada não está acessível.
  }
  const headerOffset = format === "A4" ? 82 : 52;
  const headerY = doc.page.margins.top;
  doc
    .font("Helvetica-Bold")
    .fontSize(format === "A4" ? 18 : 12)
    .fillColor("#111827")
    .text(account.nomeFantasia || account.nome, left + headerOffset, headerY, {
      width: width - headerOffset,
    });
  doc
    .font("Helvetica")
    .fontSize(format === "A4" ? 9 : 7)
    .fillColor("#4B5563")
    .text(
      [account.documento, account.telefone, account.email]
        .filter(Boolean)
        .join(" · "),
      left + headerOffset,
      headerY + (format === "A4" ? 25 : 18),
      { width: width - headerOffset },
    );
  doc.y = headerY + (format === "A4" ? 72 : 52);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .strokeColor("#9CA3AF")
    .stroke();
  doc.moveDown(0.7);
  doc
    .font("Helvetica-Bold")
    .fontSize(format === "A4" ? 16 : 12)
    .fillColor("#111827")
    .text("Comprovante de ordem de serviço", { align: "center" });
  doc
    .font("Helvetica")
    .fontSize(format === "A4" ? 10 : 8)
    .fillColor("#4B5563")
    .text(order.codigoRastreio, { align: "center" });

  section("Dados da ordem");
  line("Status", statusLabels[order.status] || order.status);
  line("Abertura", date(order.createdAt));
  line("Prazo previsto", date(order.prazoPrevisto));
  line("Tipo", order.tipo === "ENCOMENDA" ? "Encomenda" : "Serviço");
  line("Solicitação", base.descricao || "Não informada");
  line("Garantia", base.garantia);
  if (order.observacoes) line("Observações", order.observacoes);

  section("Cliente");
  line("Nome", base.Cliente?.nome || "Cliente não informado");
  if (base.Cliente?.telefone) line("Telefone", base.Cliente.telefone);
  if (base.Cliente?.email) line("E-mail", base.Cliente.email);

  section("Peças");
  if (!pieces.length)
    doc.font("Helvetica").fontSize(9).text("Nenhuma peça detalhada.");
  for (const piece of pieces) {
    ensureSpace(62);
    doc
      .font("Helvetica-Bold")
      .fontSize(format === "A4" ? 10 : 8)
      .fillColor("#111827")
      .text(`${piece.codigoRastreio} · ${piece.descricao}`);
    doc
      .font("Helvetica")
      .fontSize(format === "A4" ? 9 : 7)
      .fillColor("#4B5563");
    if (piece.metal) doc.text(`Metal: ${piece.metal}`);
    if (piece.pedras) doc.text(`Pedras/detalhes: ${piece.pedras}`);
    if (piece.pesoInformado != null)
      doc.text(
        `Peso informado: ${Number(piece.pesoInformado).toLocaleString("pt-BR")} g`,
      );
    if (piece.estadoConservacao) doc.text(`Estado: ${piece.estadoConservacao}`);
    const piecePhotos = photos.filter(
      (photo: any) => photo.pecaId === piece.id,
    );
    for (const photo of piecePhotos) {
      ensureSpace(format === "A4" ? 175 : 145);
      doc
        .moveDown(0.3)
        .font("Helvetica-Bold")
        .fontSize(format === "A4" ? 8 : 7)
        .fillColor("#374151")
        .text(
          `Foto de ${piece.codigoRastreio}${photo.descricao ? ` · ${photo.descricao}` : ""}`,
        );
      try {
        const source = await resolveRenderableImageSource(photo.url);
        const imageY = doc.y + 4;
        doc.image(source, left, imageY, {
          fit: [width, format === "A4" ? 145 : 115],
          align: "center",
        });
        doc.y = imageY + (format === "A4" ? 150 : 120);
      } catch {
        doc
          .font("Helvetica")
          .fillColor("#6B7280")
          .text("Foto indisponível no momento da emissão.");
      }
    }
    doc.moveDown(0.45);
  }

  if (budget) {
    section(`Valores · orçamento versão ${budget.versao}`);
    for (const service of services)
      line(
        service.descricao,
        `${service.quantidade} × ${currency(service.valor)} = ${currency(new Decimal(service.valor || 0).mul(service.quantidade || 0))}`,
      );
    for (const material of materials) {
      if (material.fornecidoPeloCliente) continue;
      const product = products.find((item) => item.id === material.produtoId);
      line(
        product?.nome || `Material #${material.produtoId}`,
        `${Number(material.medidaPlanejada).toLocaleString("pt-BR")} ${material.unidade === "PESO" ? "g" : "un."} × ${currency(material.valorUnitario)}`,
      );
    }
    if (Number(budget.desconto))
      line("Desconto", `− ${currency(budget.desconto)}`);
    line("Valor total", currency(budget.valorFinal));
    line("Antecipação já deixada", currency(order.antecipacaoCliente));
    line(
      "Saldo na conclusão",
      currency(
        Decimal.max(
          0,
          new Decimal(budget.valorFinal || 0).minus(
            order.antecipacaoCliente || 0,
          ),
        ),
      ),
    );
  }

  doc.moveDown(1);
  ensureSpace(45);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .strokeColor("#D1D5DB")
    .stroke();
  doc
    .moveDown(0.5)
    .font("Helvetica")
    .fontSize(format === "A4" ? 8 : 7)
    .fillColor("#6B7280")
    .text(
      `Emitido em ${new Date().toLocaleString("pt-BR")} · Documento não fiscal`,
      { align: "center" },
    );
  doc.end();
}
