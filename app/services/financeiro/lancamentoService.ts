import { Request, Response } from "express";
import { Decimal } from "decimal.js";
import dayjs from "dayjs";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { enqueuePushNotification } from "../pushNotificationQueueService";

export class LancamentoFinanceiroService {
  static validarDados(req: Request) {
    const {
      descricao,
      valorTotal,
      valorEntrada = 0,
      dataEntrada = null,
      desconto = 0,
      tipo,
      formaPagamento,
      categoriaId,
      dataLancamento,
      parcelas = 1,
    } = req.body;

    if (!parcelas || parcelas < 1) {
      throw new Error("Número de parcelas deve ser de 1 ou mais.");
    }

    if (!descricao || !valorTotal || !tipo || !formaPagamento || !categoriaId) {
      throw new Error("Campos obrigatórios não preenchidos.");
    }

    if (valorEntrada > valorTotal) {
      throw new Error("Valor de entrada maior que o valor total.");
    }

    if (valorEntrada > 0 && !dataEntrada) {
      throw new Error("Data de entrada precisa ser informada quando existe um valor de entrada.");
    }

    if (desconto > valorTotal) {
      throw new Error("Desconto maior que o valor total.");
    }
  }

  static calcularValores(valorTotal: number, valorEntrada: number, desconto: number, parcelas: number) {
    const valorBrutoTotal = new Decimal(valorTotal);
    const valorTotalDecimal = valorBrutoTotal.minus(desconto);
    const valorEntradaDecimal = new Decimal(valorEntrada);
    const valorParcelado = valorTotalDecimal.minus(valorEntradaDecimal);
    const valorParcela = valorParcelado.dividedBy(parcelas).toDecimalPlaces(2);

    return { valorBrutoTotal, valorTotalDecimal, valorEntradaDecimal, valorParcela };
  }

  static async criar(req: Request, res: Response): Promise<any> {
    try {
      const customData = getCustomRequest(req).customData;
      const {
        descricao,
        valorTotal,
        valorEntrada = 0,
        dataEntrada = null,
        desconto = 0,
        tipo,
        formaPagamento,
        status = "PENDENTE",
        clienteId,
        categoriaId,
        dataLancamento,
        parcelas = 1,
        contasFinanceiroId,
      } = req.body;

      this.validarDados(req);

      const recorrente = parcelas > 1;

      const {
        valorBrutoTotal,
        valorTotalDecimal,
        valorEntradaDecimal,
        valorParcela,
      } = this.calcularValores(valorTotal, valorEntrada, desconto, parcelas);

      const novoLancamento = await prisma.lancamentoFinanceiro.create({
        data: {
          descricao,
          Uid: gerarIdUnicoComMetaFinal("FIN"),
          valorTotal: valorTotalDecimal,
          valorEntrada: valorEntradaDecimal,
          dataEntrada: dataEntrada ? new Date(dataEntrada) : null,
          valorBruto: valorBrutoTotal,
          desconto: new Decimal(desconto),
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

      if (valorEntrada > 0 && dataEntrada) {
        await prisma.parcelaFinanceiro.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("PAR"),
            numero: 0,
            valor: valorEntradaDecimal,
            vencimento: new Date(dataEntrada),
            pago: true,
            valorPago: valorEntradaDecimal,
            dataPagamento: new Date(dataEntrada),
            formaPagamento: "DINHEIRO",
            lancamentoId: novoLancamento.id,
          },
        });
      }

      const listaParcelas = Array.from({ length: parcelas }, (_, i) => ({
        Uid: gerarIdUnicoComMetaFinal("PAR"),
        numero: i + 1,
        valor: valorParcela,
        vencimento: dayjs(dataLancamento).add(i, "month").toDate(),
        lancamentoId: novoLancamento.id,
      }));

      if (parcelas > 0) {
        await prisma.parcelaFinanceiro.createMany({ data: listaParcelas });
      }

      await enqueuePushNotification(
        {
          title: "Lançamento criado.",
          body: `Um novo lançamento foi criado: ${descricao}, com o valor de R$ ${valorTotal}`,
        },
        customData.contaId
      );

      return res.status(201).json({
        message: "Lançamento criado com sucesso",
        id: novoLancamento.id,
      });
    } catch (error: any) {
      console.error("Erro ao criar lançamento:", error);
      return res.status(500).json({ message: error.message || "Erro interno ao criar lançamento" });
    }
  }
}
