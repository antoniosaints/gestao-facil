import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import PDFDocument from "pdfkit";
import { atualizarStatusLancamentos } from "./hooks";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";

export const criarLancamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const {
      descricao,
      valorTotal,
      valorEntrada = 0,
      desconto = 0,
      tipo,
      formaPagamento,
      status = "PENDENTE",
      clienteId,
      categoriaId,
      dataLancamento,
      parcelas = 1,
      contasFinanceiroId,
      recorrente = false,
    } = req.body;

    const totalParcelas = parcelas > 0 ? parcelas : 1;

    if (!descricao || !valorTotal || !tipo || !formaPagamento || !categoriaId) {
      return res
        .status(400)
        .json({ erro: "Campos obrigatórios não preenchidos." });
    }

    const valorBrutoTotal = new Decimal(valorTotal);
    const valorTotalDecimal = valorBrutoTotal.minus(desconto || 0);
    const valorEntradaDecimal = new Decimal(valorEntrada || 0);
    const valorParcelado = valorTotalDecimal.minus(valorEntradaDecimal);
    const valorParcela =
      totalParcelas > 0
        ? valorParcelado.dividedBy(totalParcelas).toDecimalPlaces(2)
        : new Decimal(0);

    const novoLancamento = await prisma.lancamentoFinanceiro.create({
      data: {
        descricao,
        Uid: gerarIdUnicoComMetaFinal("FIN"),
        valorTotal: valorTotalDecimal,
        valorEntrada: valorEntradaDecimal,
        valorBruto: valorBrutoTotal,
        desconto: new Decimal(desconto || 0),
        tipo,
        formaPagamento,
        status,
        clienteId: clienteId || null,
        categoriaId,
        contaId: customData.contaId,
        recorrente,
        contasFinanceiroId: contasFinanceiroId || null,
        dataLancamento: new Date(dataLancamento),
      },
    });

    // Criação das parcelas
    const listaParcelas = [];

    for (let i = 0; i < totalParcelas; i++) {
      const vencimento = dayjs(dataLancamento).add(i, "month").toDate();

      listaParcelas.push({
        Uid: gerarIdUnicoComMetaFinal("PAR"),
        numero: i + 1,
        valor: valorParcela,
        vencimento,
        lancamentoId: novoLancamento.id,
      });
    }

    if (totalParcelas > 0) {
      await prisma.parcela.createMany({ data: listaParcelas });
    }

    await enqueuePushNotification(
      {
        title: "Lançamento criado.",
        body: `Um novo lançamento foi criado: ${descricao}, com o valor de R$ ${valorTotal}.`,
      },
      customData.contaId
    );

    return res.status(201).json({
      message: "Lançamento criado com sucesso",
      id: novoLancamento.id,
    });
  } catch (error: any) {
    console.error("Erro ao criar lançamento:", error);
    return res.status(500).json({ erro: "Erro interno ao criar lançamento" });
  }
};

export const pagarParcela = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  try {
    const parcela = await prisma.parcela.findUnique({
      where: { id: parcelaId },
    });

    if (!parcela) {
      return res.status(404).json({ erro: "Parcela não encontrada." });
    }

    if (parcela.pago) {
      return res.status(400).json({ erro: "Parcela já está paga." });
    }

    await prisma.parcela.update({
      where: { id: parcelaId },
      data: {
        pago: true,
        dataPagamento: new Date(),
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Parcela paga com sucesso." });
  } catch (error: any) {
    console.error("Erro ao pagar parcela:", error);
    return res.status(500).json({ erro: "Erro ao pagar parcela." });
  }
};

export const pagarMultiplasParcelas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { ids } = req.body; // Ex: [1, 2, 3]
  const customData = getCustomRequest(req).customData;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res
      .status(400)
      .json({ erro: "Informe um array de IDs de parcelas." });
  }

  try {
    await prisma.parcela.updateMany({
      where: { id: { in: ids }, pago: false },
      data: {
        pago: true,
        dataPagamento: new Date(),
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Parcelas pagas com sucesso." });
  } catch (error: any) {
    console.error("Erro ao pagar parcelas:", error);
    return res.status(500).json({ erro: "Erro ao pagar parcelas." });
  }
};

export const estornarParcela = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  try {
    const parcela = await prisma.parcela.findUnique({
      where: { id: parcelaId },
    });

    if (!parcela || !parcela.pago) {
      return res
        .status(400)
        .json({ erro: "Parcela não existe ou não foi paga." });
    }

    await prisma.parcela.update({
      where: { id: parcelaId },
      data: {
        pago: false,
        dataPagamento: null,
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Pagamento estornado com sucesso." });
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao estornar parcela." });
  }
};

export const listarParcelas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { clienteId, vencimentoInicio, vencimentoFim } = req.query;

  try {
    const parcelas = await prisma.parcela.findMany({
      where: {
        lancamento: {
          clienteId: clienteId ? parseInt(clienteId as string) : undefined,
        },
        vencimento: {
          gte: vencimentoInicio
            ? new Date(vencimentoInicio as string)
            : undefined,
          lte: vencimentoFim ? new Date(vencimentoFim as string) : undefined,
        },
      },
      include: {
        lancamento: {
          select: {
            descricao: true,
            tipo: true,
            cliente: true,
            categoria: true,
          },
        },
      },
      orderBy: { vencimento: "asc" },
    });

    return res.json(parcelas);
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao listar parcelas." });
  }
};

export const gerarReciboPdf = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);

  const parcela = await prisma.parcela.findUnique({
    where: { id: parcelaId },
    include: {
      lancamento: {
        include: {
          cliente: true,
          categoria: true,
          ContasFinanceiro: true,
        },
      },
    },
  });

  if (!parcela || !parcela.pago) {
    return res
      .status(400)
      .json({ erro: "Parcela não encontrada ou não foi paga." });
  }

  const doc = new PDFDocument({ size: "A6", margin: 20 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename=recibo-parcela-${parcela.id}.pdf`
  );
  doc.pipe(res);

  doc.fontSize(12).text("RECIBO DE PAGAMENTO", { align: "center" });
  doc.moveDown();

  doc
    .fontSize(10)
    .text(`Cliente: ${parcela.lancamento.cliente?.nome || "N/A"}`);
  doc.text(`Descrição: ${parcela.lancamento.descricao}`);
  doc.text(`Categoria: ${parcela.lancamento.categoria.nome}`);
  doc.text(`Valor: R$ ${parcela.valor.toFixed(2)}`);
  doc.text(
    `Data do Pagamento: ${dayjs(parcela.dataPagamento).format("DD/MM/YYYY")}`
  );
  doc.text(`Forma de Pagamento: ${parcela.lancamento.formaPagamento}`);
  doc.text(`Conta: ${parcela.lancamento.ContasFinanceiro?.nome}`);

  doc.moveDown();
  doc
    .fontSize(9)
    .text("Este recibo confirma o pagamento da parcela registrada no sistema.");
  doc.text("Obrigado pela preferência.", { align: "center" });

  doc.end();
};

export const deletarLancamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  const id = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  try {
    const lancamento = await prisma.lancamentoFinanceiro.findUnique({
      where: { id, contaId: customData.contaId },
    });

    if (!lancamento) {
      return res.status(404).json({ erro: "Lançamento não encontrado." });
    }

    // Deleta o lançamento
    await prisma.lancamentoFinanceiro.delete({
      where: { id, contaId: customData.contaId },
    });

    return res.json({ message: "Lançamento deletado com sucesso." });
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao deletar o lançamento." });
  }
};
