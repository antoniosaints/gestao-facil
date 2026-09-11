import type { Request, Response } from "express";
import { format } from "date-fns";
import PDFDocument from "pdfkit";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { decimalToNumber } from "./queryFilters";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { gerarQrCodeBuffer, QrCodePix } from "../../services/qrcodeGenerator";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: Date) {
  return format(value, "dd/MM/yyyy");
}

function parseSelectedParcelas(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export const gerarCobrancaLancamentoPdf = async (req: Request, res: Response): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;
    const lancamentoId = Number(req.params.id);
    if (!Number.isInteger(lancamentoId) || lancamentoId <= 0) {
      return res.status(400).json({ message: "Informe um lançamento válido." });
    }

    const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() : "";
    if (observacao.length > 2_000) {
      return res.status(400).json({ message: "A observação pode ter no máximo 2.000 caracteres." });
    }

    const incluirPix = Boolean(req.body?.incluirPix);
    const chavePixInformada = typeof req.body?.chavePix === "string" ? req.body.chavePix.trim() : "";
    const parcelaIds = parseSelectedParcelas(req.body?.parcelaIds);

    const [lancamento, conta, parametros] = await Promise.all([
      prisma.lancamentoFinanceiro.findFirst({
        where: { id: lancamentoId, contaId },
        select: {
          id: true,
          Uid: true,
          descricao: true,
          tipo: true,
          dataLancamento: true,
          cliente: { select: { nome: true, documento: true } },
          categoria: { select: { nome: true } },
          parcelas: {
            select: { id: true, numero: true, descricao: true, valor: true, vencimento: true, pago: true },
            orderBy: [{ vencimento: "asc" }, { numero: "asc" }, { id: "asc" }],
          },
        },
      }),
      prisma.contas.findUnique({
        where: { id: contaId },
        select: { nome: true, nomeFantasia: true, documento: true, telefone: true, email: true, profile: true },
      }),
      prisma.parametrosConta.findUnique({ where: { contaId }, select: { chavePix: true } }),
    ]);

    if (!lancamento || !conta) {
      return res.status(404).json({ message: "Lançamento não encontrado." });
    }

    const parcelas = parcelaIds.length
      ? lancamento.parcelas.filter((parcela) => parcelaIds.includes(parcela.id))
      : lancamento.parcelas;
    if (!parcelas.length) {
      return res.status(400).json({ message: "Selecione ao menos uma parcela para exportar." });
    }

    const chavePix = chavePixInformada || parametros?.chavePix?.trim() || "";
    if (incluirPix && !chavePix) {
      return res.status(400).json({ message: "Informe uma chave PIX para incluir o pagamento no PDF." });
    }

    const totalSelecionado = parcelas.reduce((total, parcela) => total + decimalToNumber(parcela.valor), 0);
    const totalLancamento = lancamento.parcelas.reduce((total, parcela) => total + decimalToNumber(parcela.valor), 0);
    let pixPayload: string | null = null;
    let qrCode: Buffer | null = null;
    if (incluirPix) {
      try {
        pixPayload = QrCodePix({
          version: "01",
          key: chavePix,
          city: "SAO PAULO",
          name: conta.nomeFantasia || conta.nome,
          value: totalSelecionado,
          message: `Cobranca ${lancamento.Uid || lancamento.id}`,
        }).payload();
        qrCode = await gerarQrCodeBuffer(pixPayload);
      } catch {
        return res.status(400).json({ message: "A chave PIX informada não pôde gerar um QR Code válido." });
      }
    }
    const doc = new PDFDocument({ size: "A4", margin: 46, bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cobranca-${lancamento.Uid || lancamento.id}.pdf"`,
    );
    doc.pipe(res);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const ensureSpace = (height: number) => {
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    };
    // O PDFKit mantém o último `x` usado em chamadas com coordenadas. Sem
    // reposicioná-lo, os blocos seguintes podem começar na coluna "Valor".
    const setContentCursor = (y: number = doc.y) => {
      doc.x = left;
      doc.y = y;
    };

    try {
      const logoSource = await resolveRenderableImageSource(conta.profile);
      doc.image(logoSource, left, 40, { fit: [72, 56] });
    } catch {
      // A cobrança permanece exportável mesmo sem logo cadastrado ou acessível.
    }

    doc
      .fillColor("#111827")
      .fontSize(19)
      .font("Helvetica-Bold")
      .text(conta.nomeFantasia || conta.nome, left + 92, 42, { width: width - 92 });
    doc
      .fillColor("#4B5563")
      .fontSize(10)
      .font("Helvetica")
      .text("Cobrança financeira", left + 92, 68, { width: width - 92 })
      .text(`Emitida em ${formatDate(new Date())}`, left + 92, 83, { width: width - 92 });
    doc.moveTo(left, 114).lineTo(right, 114).strokeColor("#D1D5DB").stroke();

    setContentCursor(136);
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(14).text("Dados da cobrança");
    doc.moveDown(0.45);
    doc.font("Helvetica").fontSize(10).fillColor("#374151");
    doc.text(`Descrição: ${lancamento.descricao}`, { width });
    doc.text(`Referência: ${lancamento.Uid || `#${lancamento.id}`}`);
    doc.text(`Categoria: ${lancamento.categoria.nome}`);
    if (lancamento.cliente) {
      doc.text(`Cliente: ${lancamento.cliente.nome}${lancamento.cliente.documento ? ` · ${lancamento.cliente.documento}` : ""}`);
    }
    doc.moveDown(0.7);

    ensureSpace(58);
    setContentCursor();
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Parcelas incluídas");
    doc.moveDown(0.35);
    const tableTop = doc.y;
    const columns = { parcela: left, vencimento: left + 250, valor: right - 105 };
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#6B7280")
      .text("PARCELA", columns.parcela, tableTop)
      .text("VENCIMENTO", columns.vencimento, tableTop)
      .text("VALOR", columns.valor, tableTop, { width: 105, align: "right" });
    doc.moveTo(left, tableTop + 16).lineTo(right, tableTop + 16).strokeColor("#E5E7EB").stroke();
    doc.y = tableTop + 23;

    for (const parcela of parcelas) {
      ensureSpace(28);
      const label = parcela.descricao?.trim() || `Parcela ${parcela.numero}`;
      const rowY = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#1F2937")
        .text(label, columns.parcela, rowY, { width: 230, ellipsis: true })
        .text(formatDate(parcela.vencimento), columns.vencimento, rowY)
        .text(formatCurrency(decimalToNumber(parcela.valor)), columns.valor, rowY, { width: 105, align: "right" });
      doc.y = rowY + 22;
      doc.moveTo(left, doc.y - 5).lineTo(right, doc.y - 5).strokeColor("#F3F4F6").stroke();
    }

    ensureSpace(78);
    setContentCursor(doc.y + 4);
    const totalY = doc.y;
    doc.rect(left, totalY, width, 58).fill("#F0FDF4");
    doc.fillColor("#166534").font("Helvetica").fontSize(10).text("Total das parcelas selecionadas", left + 14, totalY + 13);
    doc.fillColor("#166534").font("Helvetica-Bold").fontSize(16)
      .text(formatCurrency(totalSelecionado), right - 175, totalY + 10, { width: 160, align: "right" });
    if (parcelas.length !== lancamento.parcelas.length) {
      doc.font("Helvetica").fontSize(9).text(`Total de todas as parcelas: ${formatCurrency(totalLancamento)}`, left + 14, totalY + 34);
    }
    setContentCursor(totalY + 76);

    if (observacao) {
      ensureSpace(62);
      setContentCursor();
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Observação");
      doc.moveDown(0.35);
      doc.font("Helvetica").fontSize(10).fillColor("#374151").text(observacao, { width });
      doc.moveDown(0.8);
    }

    if (incluirPix) {
      ensureSpace(175);
      setContentCursor();
      const pixTitleY = doc.y;
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(13)
        .text("Pague via PIX", left, pixTitleY, { width, align: "center" });
      const qrSize = 100;
      const qrY = doc.y + 8;
      doc.image(qrCode!, (doc.page.width - qrSize) / 2, qrY, { width: qrSize });
      setContentCursor(qrY + qrSize + 8);
      doc.font("Helvetica").fontSize(9).fillColor("#4B5563")
        .text(`Chave PIX: ${chavePix}`, left, doc.y, { width, align: "center" });
      setContentCursor(doc.y);
      doc.fontSize(7).text(pixPayload!, left, doc.y, { width, align: "center" });
    }

    doc.end();
  } catch (error) {
    handleError(res, error);
  }
};
