import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import PDFDocument from "pdfkit";
import { atualizarStatusLancamentos } from "./hooks";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { addHours } from "date-fns";
import { formatCurrency } from "../../utils/formatters";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";

export const getLancamentosMensal = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { mes } = req.query;
    const customData = getCustomRequest(req).customData;
    if (!mes)
      return res
        .status(400)
        .json({ error: "Informe o mês no formato YYYY-MM" });

    const inicio = new Date(`${mes}-01T00:00:00`);
    const fim = new Date(inicio);
    fim.setMonth(fim.getMonth() + 1);

    // Busca parcelas do mês com dados do lançamento
    const parcelas = await prisma.parcelaFinanceiro.findMany({
      where: {
        vencimento: {
          gte: inicio,
          lt: fim,
        },
        lancamento: {
          contaId: customData.contaId,
        },
      },
      include: {
        lancamento: {
          include: {
            categoria: true,
          }
        },
      },
      orderBy: {
        vencimento: "desc",
      },
    });

    // Agrupamento por dia
    const agrupado = parcelas.reduce((acc: any, parcela) => {
      const dia = parcela.vencimento.toISOString().split("T")[0];

      if (!acc[dia]) {
        acc[dia] = {
          dia,
          lancamentos: [],
          saldo: new Decimal(0),
        };
      }

      const lanc = parcela.lancamento;
      const valor = parcela.valor;
      const status = parcela.pago ? "PAGO" : "PENDENTE";

      acc[dia].lancamentos.push({
        id: lanc.id,
        categoria: lanc.categoria.nome,
        parcelaId: parcela.id,
        descricao: lanc.descricao,
        valor: Number(valor),
        status,
        tipo: lanc.tipo,
      });

      // Soma ou subtrai no saldo diário
      if (lanc.tipo === "RECEITA") {
        acc[dia].saldo = acc[dia].saldo.add(valor);
      } else if (lanc.tipo === "DESPESA") {
        acc[dia].saldo = acc[dia].saldo.sub(valor);
      }

      return acc;
    }, {});

    const data = Object.values(agrupado).map((d: any) => ({
      dia: d.dia,
      lancamentos: d.lancamentos,
      saldo: Number(d.saldo),
    }));

    return res.json({ data });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao listar lançamentos" });
  }
};

export const getLacamento = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { id } = req.params;
    const lancamento = await prisma.lancamentoFinanceiro.findUnique({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
      include: {
        parcelas: true,
      },
    });

    return ResponseHandler(res, "Lancamento encontrado", lancamento);
  } catch (error) {
    handleError(res, error);
  }
};
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
      dataEntrada = null,
      desconto = 0,
      tipoLancamentoModo = "AVISTA",
      lancamentoEfetivado,
      tipo,
      formaPagamento,
      status = "PENDENTE",
      clienteId,
      categoriaId,
      dataLancamento,
      parcelas = 1,
      contasFinanceiroId,
    } = req.body;

    let hasEfetivadoTotal = false;

    if (lancamentoEfetivado && lancamentoEfetivado == true) {
      hasEfetivadoTotal = true;
    }

    if (!parcelas) {
      return res.status(400).json({
        message:
          "Informe o número de parcelas, para lançamentos à vista, informe 1",
      });
    } else {
      if (parcelas < 0) {
        return res
          .status(400)
          .json({ message: "Número de parcelas deve ser de 1 ou mais." });
      }
    }

    const totalParcelas = parcelas > 0 ? parcelas : 1;
    let lancamentoRecorrente = false;

    if (tipoLancamentoModo === "PARCELADO") {
      lancamentoRecorrente = true;
    }

    if (!descricao || !valorTotal || !tipo || !formaPagamento || !categoriaId) {
      return res
        .status(400)
        .json({ message: "Campos obrigatórios não preenchidos." });
    }

    const valorTotalFormated = new Decimal(valorTotal);
    const valorEntradaFormated = new Decimal(valorEntrada || 0);
    const descontoFormated = new Decimal(desconto || 0);

    if (valorEntradaFormated) {
      if (valorEntradaFormated.toNumber() > valorTotalFormated.toNumber()) {
        return res
          .status(400)
          .json({ message: "Valor de entrada maior que o valor total." });
      }

      if (valorEntradaFormated.toNumber() > 0 && !dataEntrada) {
        return res.status(400).json({
          message:
            "Data de entrada precisa ser informada quando existe um valor de entrada.",
        });
      }
    }

    if (descontoFormated) {
      if (descontoFormated.toNumber() > valorTotalFormated.toNumber()) {
        return res
          .status(400)
          .json({ message: "Desconto maior que o valor total." });
      }
    }

    const valorTotalDecimal = valorTotalFormated.minus(descontoFormated || 0);
    const valorEntradaDecimal = valorEntradaFormated;
    const valorParcelado = valorTotalDecimal.minus(valorEntradaDecimal);
    const valorParcela =
      totalParcelas > 0
        ? valorParcelado.dividedBy(totalParcelas).toDecimalPlaces(2)
        : new Decimal(0);

    const lancamentoTx = await prisma.$transaction(async (tx) => {
      const novoLancamento = await tx.lancamentoFinanceiro.create({
        data: {
          descricao,
          Uid: gerarIdUnicoComMetaFinal("FIN"),
          valorTotal: valorTotalDecimal,
          valorEntrada: valorEntradaDecimal,
          dataEntrada: dataEntrada ? new Date(dataEntrada) : null,
          valorBruto: valorTotalFormated,
          desconto: descontoFormated,
          tipo,
          formaPagamento,
          status: hasEfetivadoTotal ? "PAGO" : "PENDENTE",
          clienteId: Number(clienteId) || null,
          categoriaId: Number(categoriaId),
          contaId: customData.contaId,
          recorrente: lancamentoRecorrente,
          contasFinanceiroId: Number(contasFinanceiroId) || null,
          dataLancamento: addHours(new Date(dataLancamento), 3),
        },
      });

      if (valorEntrada && valorEntradaFormated.toNumber() > 0 && dataEntrada) {
        await tx.parcelaFinanceiro.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 0,
            valor: valorEntradaFormated,
            vencimento: addHours(new Date(dataEntrada), 3),
            pago: true,
            valorPago: valorEntradaFormated,
            dataPagamento: addHours(new Date(dataEntrada), 3),
            formaPagamento,
            lancamentoId: novoLancamento.id,
          },
        });
      }

      // Criação das parcelas
      const listaParcelas = [];

      for (let i = 0; i < totalParcelas; i++) {
        const vencimento = dayjs(dataLancamento).add(i, "month").toDate();

        listaParcelas.push({
          Uid: gerarIdUnicoComMetaFinal("PAR"),
          numero: i + 1,
          valor: valorParcela,
          pago: hasEfetivadoTotal ? true : false,
          valorPago: hasEfetivadoTotal ? valorParcela : null,
          formaPagamento: hasEfetivadoTotal ? formaPagamento : null,
          dataPagamento: hasEfetivadoTotal ? addHours(vencimento, 3) : null,
          vencimento: addHours(vencimento, 3),
          lancamentoId: novoLancamento.id,
        });
      }

      if (totalParcelas > 0) {
        await tx.parcelaFinanceiro.createMany({ data: listaParcelas });
      }

      return novoLancamento;
    });

    await enqueuePushNotification(
      {
        title: "Lançamento criado.",
        body: `${lancamentoTx.tipo}: ${descricao}, no valor de ${formatCurrency(
          valorTotalDecimal
        )}`,
      },
      customData.contaId
    );

    return res.status(201).json({
      message: "Lançamento criado com sucesso",
      id: lancamentoTx.id,
    });
  } catch (error: any) {
    console.error("Erro ao criar lançamento:", error);
    return handleError(res, error);
  }
};

export const pagarParcela = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  if (!req.body) return res.status(400).json({ message: "Dados obrigatorio!" });
  if (!req.body.metodoPagamento || !req.body.dataPagamento) return res.status(400).json({ message: "Preencha os dados (metodoPagamento, dataPagamento)!" });
  try {
    const parcela = await prisma.parcelaFinanceiro.findUnique({
      where: { id: parcelaId, lancamento: { contaId: customData.contaId } },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    if (parcela.pago) {
      return res.status(400).json({ message: "Parcela já está paga." });
    }

    await prisma.parcelaFinanceiro.update({
      where: { id: parcelaId },
      data: {
        pago: true,
        valorPago: parcela.valor,
        formaPagamento: req.body.metodoPagamento,
        dataPagamento: new Date(req.body.dataPagamento),
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Parcela paga com sucesso." });
  } catch (error: any) {
    console.error("Erro ao pagar parcela:", error);
    return res.status(500).json({ message: "Erro ao pagar parcela." });
  }
};

export const pagarMultiplasParcelas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { parcelas } = req.body; // Ex: [1, 2, 3]
  const customData = getCustomRequest(req).customData;
  if (!Array.isArray(parcelas) || parcelas.length === 0) {
    return res
      .status(400)
      .json({ message: "Informe um array de parcelas de parcelas." });
  }

  try {
    await prisma.parcelaFinanceiro.updateMany({
      where: { id: { in: parcelas }, pago: false },
      data: {
        pago: true,
        formaPagamento: "PIX",
        dataPagamento: new Date(),
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Parcelas pagas com sucesso." });
  } catch (error: any) {
    console.error("Erro ao pagar parcelas:", error);
    return res.status(500).json({ message: "Erro ao pagar parcelas." });
  }
};

export const estornarParcela = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);
  const customData = getCustomRequest(req).customData;
  try {
    const parcela = await prisma.parcelaFinanceiro.findUnique({
      where: { id: parcelaId },
    });

    if (!parcela || !parcela.pago) {
      return res
        .status(400)
        .json({ message: "Parcela não existe ou não foi paga." });
    }

    await prisma.parcelaFinanceiro.update({
      where: { id: parcelaId },
      data: {
        pago: false,
        formaPagamento: null,
        dataPagamento: null,
      },
    });

    await atualizarStatusLancamentos(customData.contaId);

    return res.json({ message: "Pagamento estornado com sucesso." });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao estornar parcela." });
  }
};

export const listarParcelas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { clienteId, vencimentoInicio, vencimentoFim } = req.query;

  try {
    const parcelas = await prisma.parcelaFinanceiro.findMany({
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
    return res.status(500).json({ message: "Erro ao listar parcelas." });
  }
};

export const gerarReciboPdf = async (
  req: Request,
  res: Response
): Promise<any> => {
  const parcelaId = parseInt(req.params.id);

  const parcela = await prisma.parcelaFinanceiro.findUnique({
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
