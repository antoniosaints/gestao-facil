import { Request, Response } from "express";
import Decimal from "decimal.js";
import dayjs from "dayjs";
import { addHours, differenceInCalendarDays, startOfDay } from "date-fns";
import PDFDocument from "pdfkit";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { atualizarStatusLancamentos } from "./hooks";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import {
  aplicarDeslocamentoData,
  criarLancamentoFinanceiro,
  filtrarParcelasPorEscopo,
  type EscopoAtualizacaoParcela,
} from "../../services/financeiro/lancamentoService";
import { buildParcelaFinanceiroWhere, decimalToNumber, getParcelaStatus, matchesStatusFilter, parseFinanceiroFilters } from "./queryFilters";
import { assertFutureSettlementAllowed } from "../../services/financeiro/financeiroPolicyService";
import { processarPosPagamentoAssinaturaPagar } from "../../services/financeiro/assinaturasPagarService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";

export const updateParcela = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const escopo = ((req.body?.escopo as EscopoAtualizacaoParcela | undefined) || "ATUAL") as EscopoAtualizacaoParcela;

    if (!id || isNaN(Number(id))) return res.status(400).json({ message: "Informe o id da parcela!" });
    if (!req.body) return res.status(400).json({ message: "Informe os dados a serem atualizados (vencimento, valor)!" });

    const dataValida = dayjs(req.body.vencimento).isValid();
    if (!dataValida) return res.status(400).json({ message: "Data inválida, informe uma data válida!" });

    if (req.body.valor === undefined || req.body.valor === null || Number(req.body.valor) <= 0) {
      return res.status(400).json({ message: "Informe um valor válido para a parcela." });
    }

    const parcela = await prisma.parcelaFinanceiro.findFirst({
      where: {
        id: Number(id),
        lancamento: {
          contaId: customData.contaId,
        },
      },
      select: {
        id: true,
        numero: true,
        pago: true,
        valor: true,
        valorPago: true,
        vencimento: true,
        lancamentoId: true,
      },
    });

    if (!parcela) {
      return res.status(404).json({ message: "Parcela não encontrada." });
    }

    const novaDataBase = startOfDay(new Date(req.body.vencimento));
    const diffDias = differenceInCalendarDays(novaDataBase, startOfDay(new Date(parcela.vencimento)));
    const novoValor = new Decimal(req.body.valor);

    const parcelasLancamento = await prisma.parcelaFinanceiro.findMany({
      where: {
        lancamentoId: parcela.lancamentoId,
        lancamento: {
          contaId: customData.contaId,
        },
      },
      select: {
        id: true,
        numero: true,
        pago: true,
        valorPago: true,
        vencimento: true,
      },
      orderBy: [{ numero: "asc" }, { id: "asc" }],
    });

    const parcelasSelecionadas = filtrarParcelasPorEscopo(parcelasLancamento, parcela.id, escopo);

    if (!parcelasSelecionadas.length) {
      return res.status(400).json({ message: "Nenhuma parcela encontrada para o escopo selecionado." });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of parcelasSelecionadas) {
        await tx.parcelaFinanceiro.update({
          where: { id: item.id },
          data: {
            valor: novoValor,
            valorPago: item.pago ? novoValor : item.valorPago,
            vencimento: item.id === parcela.id ? novaDataBase : aplicarDeslocamentoData(item.vencimento, diffDias),
          },
        });
      }
    });

    await atualizarStatusLancamentos(customData.contaId);
    sendFinanceiroUpdated(customData.contaId, { reason: "parcela-atualizada" });

    return ResponseHandler(res, "Parcela atualizada", {
      parcelaId: parcela.id,
      parcelasAtualizadas: parcelasSelecionadas.length,
      escopo,
    });
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
    const saldoCompleto = req.query.saldoCompleto === "1" || req.query.saldoCompleto === "true";
    const filtersSaldo = saldoCompleto ? { ...filters, tipo: "TODOS" as const } : filters;

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

    const parcelasSaldo = saldoCompleto && filters.tipo !== "TODOS"
      ? await prisma.parcelaFinanceiro.findMany({
        where: buildParcelaFinanceiroWhere(customData.contaId, filtersSaldo),
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
      })
      : parcelas;

    const hoje = startOfDay(new Date());
    const parcelasFiltradas = parcelas.filter((parcela) => matchesStatusFilter(parcela, filters.status, hoje));
    const parcelasFiltradasSaldo = parcelasSaldo.filter((parcela) => matchesStatusFilter(parcela, filters.status, hoje));

    const parcelasDoMes = parcelasFiltradas.filter(
      (parcela) => parcela.vencimento >= inicio && parcela.vencimento <= fim
    );

    const saldoRealizadoInicial = saldoInicialTotal + parcelasFiltradasSaldo
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento < inicio)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    const saldoPrevistoInicial = saldoInicialTotal + parcelasFiltradasSaldo
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

        dia.entradasRealizadas = parcelasFiltradasSaldo
          .filter((parcela) => parcela.lancamento.tipo === "RECEITA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicioDia && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

        dia.saidasRealizadas = parcelasFiltradasSaldo
          .filter((parcela) => parcela.lancamento.tipo === "DESPESA" && parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicioDia && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + decimalToNumber(parcela.valor), 0);

        const saldoRealizado = saldoRealizadoInicial + parcelasFiltradasSaldo
          .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= fimDia)
          .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

        const saldoPrevisto = saldoPrevistoInicial + parcelasFiltradasSaldo
          .filter((parcela) => parcela.vencimento >= inicio && parcela.vencimento <= fimDia)
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

    const saldoRealizadoReferencia = saldoRealizadoInicial + parcelasFiltradasSaldo
      .filter((parcela) => parcela.pago && parcela.dataPagamento && parcela.dataPagamento >= inicio && parcela.dataPagamento <= referenciaSaldo)
      .reduce((acc, parcela) => acc + (parcela.lancamento.tipo === "RECEITA" ? decimalToNumber(parcela.valor) : -decimalToNumber(parcela.valor)), 0);

    const saldoPrevistoReferencia = saldoPrevistoInicial + parcelasFiltradasSaldo
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
        assinaturaPagar: {
          select: {
            id: true,
            Uid: true,
            nomeServico: true,
            icone: true,
            corDestaque: true,
          },
        },
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

export const updateLancamentoBasico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { id } = req.params;

    if (!id || Number.isNaN(Number(id))) {
      return res.status(400).json({ message: "Informe um lançamento válido." });
    }

    const descricao = typeof req.body?.descricao === "string" ? req.body.descricao.trim() : "";
    const categoriaId = Number(req.body?.categoriaId);
    const contasFinanceiroId = Number(req.body?.contasFinanceiroId);
    const clienteId = req.body?.clienteId === null || req.body?.clienteId === undefined || req.body?.clienteId === ""
      ? null
      : Number(req.body?.clienteId);
    const formaPagamento = typeof req.body?.formaPagamento === "string" ? req.body.formaPagamento.trim().toUpperCase() : "";

    const formasPagamentoValidas = [
      "DINHEIRO",
      "DEBITO",
      "CREDITO",
      "BOLETO",
      "DEPOSITO",
      "TRANSFERENCIA",
      "CHEQUE",
      "PIX",
    ];

    if (!descricao) {
      return res.status(400).json({ message: "Informe a descrição do lançamento." });
    }

    if (!categoriaId || Number.isNaN(categoriaId)) {
      return res.status(400).json({ message: "Informe uma categoria válida." });
    }

    if (!contasFinanceiroId || Number.isNaN(contasFinanceiroId)) {
      return res.status(400).json({ message: "Informe uma conta financeira válida." });
    }

    if (!formaPagamento || !formasPagamentoValidas.includes(formaPagamento)) {
      return res.status(400).json({ message: "Informe uma forma de pagamento válida." });
    }

    if (clienteId !== null && Number.isNaN(clienteId)) {
      return res.status(400).json({ message: "Informe um cliente válido." });
    }

    const lancamento = await prisma.lancamentoFinanceiro.findFirst({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
      select: {
        id: true,
      },
    });

    if (!lancamento) {
      return res.status(404).json({ message: "Lançamento não encontrado." });
    }

    const [categoria, contaFinanceira, cliente] = await Promise.all([
      prisma.categoriaFinanceiro.findFirst({
        where: {
          id: categoriaId,
          contaId: customData.contaId,
        },
        select: { id: true },
      }),
      prisma.contasFinanceiro.findFirst({
        where: {
          id: contasFinanceiroId,
          contaId: customData.contaId,
        },
        select: { id: true },
      }),
      clienteId === null
        ? Promise.resolve(null)
        : prisma.clientesFornecedores.findFirst({
          where: {
            id: clienteId,
            contaId: customData.contaId,
          },
          select: { id: true },
        }),
    ]);

    if (!categoria) {
      return res.status(400).json({ message: "Categoria inválida para esta conta." });
    }

    if (!contaFinanceira) {
      return res.status(400).json({ message: "Conta financeira inválida para esta conta." });
    }

    if (clienteId !== null && !cliente) {
      return res.status(400).json({ message: "Cliente/fornecedor inválido para esta conta." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.lancamentoFinanceiro.update({
        where: {
          id: Number(id),
        },
        data: {
          descricao,
          categoriaId,
          contasFinanceiroId,
          clienteId,
          formaPagamento: formaPagamento as any,
        },
      });

      await tx.parcelaFinanceiro.updateMany({
        where: {
          lancamentoId: Number(id),
          pago: false,
        },
        data: {
          contaFinanceira: contasFinanceiroId,
          formaPagamento: formaPagamento as any,
        },
      });
    });

    sendFinanceiroUpdated(customData.contaId, { reason: "lancamento-atualizado" });

    return ResponseHandler(res, "Lançamento atualizado com sucesso.", {
      id: Number(id),
      atualizacaoRestrita: true,
      parcelasPendentesAtualizadas: true,
    });
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

    const lancamentoTx = await prisma.$transaction(async (tx) => {
      return criarLancamentoFinanceiro(tx, customData.contaId, req.body);
    });

    sendFinanceiroUpdated(customData.contaId, { reason: "lancamento-criado", lancamentoId: lancamentoTx.id });

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

    await assertFutureSettlementAllowed(customData.contaId, [req.body.dataPagamento]);

    const pagamentoResult = await prisma.$transaction(async (tx) => {
      await tx.parcelaFinanceiro.update({
        where: { id: parcelaId },
        data: {
          pago: true,
          valorPago: parcela.valor,
          formaPagamento: req.body.metodoPagamento,
          dataPagamento: startOfDay(new Date(req.body.dataPagamento)),
          contaFinanceira: req.body.contaPagamento,
        },
      });

      const parcelaAtualizada = await tx.parcelaFinanceiro.findUnique({
        where: { id: parcelaId },
        select: { lancamentoId: true },
      });

      const automacao = parcelaAtualizada
        ? await processarPosPagamentoAssinaturaPagar(tx, parcelaAtualizada.lancamentoId)
        : null;

      return {
        lancamentoId: parcelaAtualizada?.lancamentoId || null,
        automacao,
      };
    });

    await atualizarStatusLancamentos(customData.contaId);
    sendFinanceiroUpdated(customData.contaId, { reason: "parcela-paga", parcelaId, lancamentoId: pagamentoResult.lancamentoId });

    if (pagamentoResult.automacao?.generated && pagamentoResult.automacao.lancamentoId) {
      sendFinanceiroUpdated(customData.contaId, {
        reason: "assinatura-pagar-proximo-lancamento-gerado",
        lancamentoId: pagamentoResult.automacao.lancamentoId,
      });
    }

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
      select: { id: true, lancamentoId: true },
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

    const lancamentosAfetados = [...new Set(parcelasPermitidas.map((item) => item.lancamentoId))];
    for (const lancamentoId of lancamentosAfetados) {
      await prisma.$transaction(async (tx) => {
        await processarPosPagamentoAssinaturaPagar(tx, lancamentoId);
      });
    }

    await atualizarStatusLancamentos(customData.contaId);
    sendFinanceiroUpdated(customData.contaId, { reason: "parcelas-pagas-em-lote", total: parcelasPermitidas.length });

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
    sendFinanceiroUpdated(customData.contaId, { reason: "parcela-estornada", parcelaId });

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

    sendFinanceiroUpdated(customData.contaId, { reason: "lancamento-deletado", lancamentoId: id });

    return res.json({ message: "Lançamento deletado com sucesso." });
  } catch (error) {
    return res.status(500).json({ erro: "Erro ao deletar o lançamento." });
  }
};
