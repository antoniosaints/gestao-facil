import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import PDFDocument from "pdfkit";
import { atualizarStatusLancamentos } from "./hooks";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { addHours, startOfDay } from "date-fns";
import { formatCurrency } from "../../utils/formatters";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { buildParcelaFinanceiroWhere, decimalToNumber, getParcelaStatus, matchesStatusFilter, parseFinanceiroFilters } from "./queryFilters";

export const updateParcela = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;

    if (!id || isNaN(Number(id))) return res.status(400).json({ message: "Informe o id da parcela!" });
    if (!req.body) return res.status(400).json({ message: "Informe os dados a serem atualizados (vencimento, valor)!" });

    const dataValida = dayjs(req.body.vencimento).isValid();
    if (!dataValida) return res.status(400).json({ message: "Data inválida, informe uma data válida!" });

    const parcela = await prisma.parcelaFinanceiro.findFirst({
      where: {
        id: Number(id),
        lancamento: {
          contaId: customData.contaId,
        },
      },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    const parcelaAtualizada = await prisma.parcelaFinanceiro.update({
      where: {
        id: Number(id),
      },
      data: {
        valor: new Decimal(req.body.valor),
        vencimento: startOfDay(new Date(req.body.vencimento)),
      },
    });

    return ResponseHandler(res, "Parcela atualizada", parcelaAtualizada);
  } catch (error) {
    handleError(res, error);
  }
}

export const getLancamentosMensal = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { mes } = req.query;
    const customData = getCustomRequest(req).customData;

    if (!mes || typeof mes !== "string") {
      return res.status(400).json({ error: "Informe o mês no formato YYYY-MM" });
    }

    const inicio = startOfDay(new Date(`${mes}-01T00:00:00`));
    const fim = startOfDay(new Date(inicio));
    fim.setMonth(fim.getMonth() + 1);
    fim.setMilliseconds(-1);

    const filters = parseFinanceiroFilters(req);

    const contasFinanceiras = await prisma.contasFinanceiro.findMany({
      where: {
        contaId: customData.contaId,
        ...(filters.contaFinanceiraId ? { id: filters.contaFinanceiraId } : {}),
      },
      select: {
        id: true,
        nome: true,
        saldoInicial: true,
      },
    });

    const saldoInicialTotal = contasFinanceiras.reduce(
      (acc, conta) => acc + decimalToNumber(conta.saldoInicial),
      0
    );

    const parcelas = await prisma.parcelaFinanceiro.findMany({
      where: buildParcelaFinanceiroWhere(customData.contaId, filters),
      select: {
        id: true,
        numero: true,
        valor: true,
        pago: true,
        vencimento: true,
        dataPagamento: true,
        contaFinanceira: true,
        formaPagamento: true,
        CobrancasFinanceiras: {
          select: {
            id: true,
            externalLink: true,
          },
        },
        ContaFinanceira: {
          select: {
            id: true,
            nome: true,
          },
        },
        lancamento: {
          select: {
            id: true,
            Uid: true,
            descricao: true,
            tipo: true,
            categoria: {
              select: {
                id: true,
                nome: true,
              },
            },
            cliente: {
              select: {
                id: true,
                nome: true,
              },
            },
          },
        },
      },
      orderBy: [{ vencimento: "asc" }, { id: "asc" }],
    });

    const hoje = startOfDay(new Date());
    const parcelasFiltradas = parcelas.filter((parcela) => matchesStatusFilter(parcela, filters.status, hoje));

    const parcelasDoMes = parcelasFiltradas.filter(
      (parcela) => parcela.vencimento >= inicio && parcela.vencimento <= fim
    );

    const saldoRealizadoInicial = saldoInicialTotal + parcelasFiltradas
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento < inicio)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    const saldoPrevistoInicial = saldoInicialTotal + parcelasFiltradas
      .filter((parcela) => parcela.vencimento < inicio)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    const agrupado = parcelasDoMes.reduce((acc, parcela) => {
      const dia = parcela.vencimento.toISOString().split("T")[0];

      if (!acc[dia]) {
        acc[dia] = {
          dia: parcela.vencimento,
          entradasPrevistas: 0,
          saidasPrevistas: 0,
          entradasRealizadas: 0,
          saidasRealizadas: 0,
          saldoRealizado: 0,
          saldoPrevisto: 0,
          lancamentos: [],
        };
      }

      const valor = decimalToNumber(parcela.valor);
      const status = getParcelaStatus(parcela, hoje);

      if (parcela.lancamento.tipo === "RECEITA") {
        acc[dia].entradasPrevistas += valor;
        if (parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= fim) {
          acc[dia].entradasRealizadas += valor;
        }
      } else {
        acc[dia].saidasPrevistas += valor;
        if (parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= fim) {
          acc[dia].saidasRealizadas += valor;
        }
      }

      acc[dia].lancamentos.push({
        id: parcela.lancamento.id,
        uid: parcela.lancamento.Uid,
        parcelaId: parcela.id,
        numero: parcela.numero,
        descricao: parcela.lancamento.descricao,
        categoria: parcela.lancamento.categoria.nome,
        cliente: parcela.lancamento.cliente?.nome || null,
        conta: parcela.ContaFinanceira?.nome || null,
        valor,
        tipo: parcela.lancamento.tipo,
        status,
        pago: parcela.pago,
        vencimento: parcela.vencimento,
        dataPagamento: parcela.dataPagamento,
        formaPagamento: parcela.formaPagamento,
        cobrancaLink: parcela.CobrancasFinanceiras[0]?.externalLink || null,
      });

      return acc;
    }, {} as Record<string, {
      dia: Date;
      entradasPrevistas: number;
      saidasPrevistas: number;
      entradasRealizadas: number;
      saidasRealizadas: number;
      saldoRealizado: number;
      saldoPrevisto: number;
      lancamentos: Array<{
        id: number;
        uid: string;
        parcelaId: number;
        numero: number;
        descricao: string;
        categoria: string;
        cliente: string | null;
        conta: string | null;
        valor: number;
        tipo: "RECEITA" | "DESPESA";
        status: "PAGO" | "PENDENTE" | "ATRASADO";
        pago: boolean;
        vencimento: Date;
        dataPagamento: Date | null;
        formaPagamento: string | null;
        cobrancaLink: string | null;
      }>;
    }>);

    const diasOrdenados = Object.values(agrupado)
      .sort((a, b) => a.dia.getTime() - b.dia.getTime())
      .map((dia) => {
        const inicioDia = startOfDay(dia.dia);
        const fimDia = new Date(inicioDia);
        fimDia.setHours(23, 59, 59, 999);

        dia.entradasRealizadas = parcelasFiltradas
          .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicioDia && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

        dia.saidasRealizadas = parcelasFiltradas
          .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicioDia && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

        const saldoRealizado = saldoRealizadoInicial + parcelasFiltradas
          .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

        const saldoPrevisto = saldoPrevistoInicial + parcelasFiltradas
          .filter((parcela) => parcela.vencimento <= fimDia)
          .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

        return {
          dia: dia.dia,
          entradasPrevistas: dia.entradasPrevistas,
          saidasPrevistas: dia.saidasPrevistas,
          entradasRealizadas: dia.entradasRealizadas,
          saidasRealizadas: dia.saidasRealizadas,
          saldoRealizado,
          saldoPrevisto,
          lancamentos: dia.lancamentos,
        };
      });

    const receitasPrevistas = parcelasDoMes
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA")
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const despesasPrevistas = parcelasDoMes
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA")
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const receitasRealizadas = parcelasFiltradas
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= fim)
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const despesasRealizadas = parcelasFiltradas
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= fim)
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const pendenteReceber = parcelasDoMes
      .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && !parcela.pago)
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const pendentePagar = parcelasDoMes
      .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && !parcela.pago)
      .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

    const referenciaSaldo =
      inicio.getMonth() === hoje.getMonth() && inicio.getFullYear() === hoje.getFullYear()
        ? hoje
        : fim;

    const saldoRealizadoReferencia = saldoRealizadoInicial + parcelasFiltradas
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= referenciaSaldo)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    const saldoPrevistoReferencia = saldoPrevistoInicial + parcelasFiltradas
      .filter((parcela) => parcela.vencimento >= inicio && parcela.vencimento <= referenciaSaldo)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    return res.json({
      data: {
        dias: diasOrdenados,
        resumo: {
          saldoInicialPeriodo: saldoRealizadoInicial,
          receitasPrevistas,
          despesasPrevistas,
          receitasRealizadas,
          despesasRealizadas,
          pendenteReceber,
          pendentePagar,
          saldoAtualDia: saldoRealizadoReferencia,
          saldoPossivelDia: saldoPrevistoReferencia,
          dataReferenciaSaldo: referenciaSaldo,
        },
      },
    });
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
    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
      include: {
        categoria: true,
        cliente: true,
        ContasFinanceiro: true,
        parcelas: {
          include: {
            CobrancasFinanceiras: true,
            ContaFinanceira: true,
          }
        },
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

    if (!descricao || !valorTotal || !tipo || !formaPagamento || !categoriaId || !contasFinanceiroId) {
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
          dataLancamento: startOfDay(new Date(dataLancamento)),
        },
      });

      if (valorEntrada && valorEntradaFormated.toNumber() > 0 && dataEntrada) {
        await tx.parcelaFinanceiro.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 0,
            valor: valorEntradaFormated,
            vencimento: startOfDay(new Date(dataEntrada)),
            pago: true,
            valorPago: valorEntradaFormated,
            dataPagamento: startOfDay(new Date(dataEntrada)),
            formaPagamento,
            lancamentoId: novoLancamento.id,
            contaFinanceira: Number(contasFinanceiroId) || null
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
          dataPagamento: hasEfetivadoTotal ? startOfDay(vencimento) : null,
          vencimento: startOfDay(vencimento),
          lancamentoId: novoLancamento.id,
          contaFinanceira: Number(contasFinanceiroId) || null
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
  if (!req.body.metodoPagamento || !req.body.dataPagamento || !req.body.contaPagamento) return res.status(400).json({ message: "Preencha os dados (metodoPagamento, dataPagamento, contaPagamento)!" });
  try {
    const parcela = await prisma.parcelaFinanceiro.findFirst({
      where: {
        id: parcelaId,
        lancamento: {
          contaId: customData.contaId,
        },
      },
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
        dataPagamento: startOfDay(new Date(req.body.dataPagamento)),
        contaFinanceira: req.body.contaPagamento,
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
    const parcelasPermitidas = await prisma.parcelaFinanceiro.findMany({
      where: {
        id: { in: parcelas },
        pago: false,
        lancamento: {
          contaId: customData.contaId,
        },
      },
      select: { id: true },
    });

    if (!parcelasPermitidas.length) {
      return res.status(404).json({ message: "Nenhuma parcela válida encontrada para pagamento." });
    }

    await prisma.parcelaFinanceiro.updateMany({
      where: { id: { in: parcelasPermitidas.map((item) => item.id) } },
      data: {
        pago: true,
        formaPagamento: "PIX",
        dataPagamento: startOfDay(new Date()),
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
    const parcela = await prisma.parcelaFinanceiro.findFirst({
      where: {
        id: parcelaId,
        pago: true,
        lancamento: {
          contaId: customData.contaId,
        },
      },
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
        valorPago: null,
        dataPagamento: null,
        contaFinanceira: null,
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
  const customData = getCustomRequest(req).customData;

  try {
    const parcelas = await prisma.parcelaFinanceiro.findMany({
      where: {
        lancamento: {
          contaId: customData.contaId,
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
  const customData = getCustomRequest(req).customData;

  const parcela = await prisma.parcelaFinanceiro.findFirst({
    where: {
      id: parcelaId,
      lancamento: {
        contaId: customData.contaId,
      },
    },
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
    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: { id, contaId: customData.contaId },
    });

    if (!lancamento) {
      return res.status(404).json({ erro: "Lançamento não encontrado." });
    }

    await prisma.lancamentoFinanceiro.deleteMany({
      where: { id, contaId: customData.contaId },
    });

    return res.json({ message: "Lançamento deletado com sucesso." });
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao deletar o lançamento." });
  }
};
