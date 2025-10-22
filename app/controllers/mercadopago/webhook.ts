import { Request, Response } from "express";
import { mercadoPagoPayment } from "../../utils/mercadoPago";
import { prisma } from "../../utils/prisma";
import {
  MetodoPagamento,
  StatusFatura,
  StatusPagamento,
} from "../../../generated";
import { addDays, addHours, isBefore } from "date-fns";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { MercadoPagoService } from "../../services/financeiro/mercadoPagoService";
import { getIO } from "../../utils/socket";

export async function getPaymentMercadoPago(req: Request, res: Response) {
  try {
    const { id } = req.query;
    const payment = await mercadoPagoPayment.get({ id: Number(id) });
    res.status(200).json(payment);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function webhookMercadoPago(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const { type, id, data } = req.body || {};
    if (type !== "payment" || !id) return res.sendStatus(204);

    const payment = await mercadoPagoPayment.get({ id: Number(data.id) });
    const { status, external_reference, transaction_amount } = payment;

    if (!external_reference) return res.sendStatus(204);
    const contaId = Number(external_reference);

    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
    });

    const vencimentoConta = conta.vencimento;
    const hoje = new Date();

    const vencimentoNovo = isBefore(vencimentoConta, hoje)
      ? addDays(hoje, 30)
      : addDays(vencimentoConta, 30);

    let statusFatura: StatusFatura = "PENDENTE";
    if (["approved", "authorized"].includes(status as string))
      statusFatura = "PAGO";
    if (["cancelled", "refunded"].includes(status as string))
      statusFatura = "CANCELADO";

    const faturaExistente = await prisma.faturasContas.findFirst({
      where: {
        contaId,
        asaasPaymentId: String(payment.id),
      },
    });

    let link_pagamento: string = "";
    if (payment.payment_type_id === "ticket") {
      link_pagamento = payment.transaction_details
        ?.external_resource_url as string;
    } else {
      link_pagamento = payment.point_of_interaction?.transaction_data
        ?.ticket_url as string;
    }

    if (!faturaExistente) {
      await prisma.faturasContas.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("INV"),
          asaasPaymentId: String(payment.id),
          urlPagamento: link_pagamento,
          valor: transaction_amount || 0,
          vencimento: addHours(hoje, 24),
          status: statusFatura,
          contaId,
        },
      });
    }

    await prisma.faturasContas.updateMany({
      where: {
        contaId,
        asaasPaymentId: String(payment.id),
      },
      data: {
        status: statusFatura,
      },
    });

    if (statusFatura === "PAGO") {
      await prisma.contas.update({
        where: { id: contaId },
        data: {
          status: "ATIVO",
          vencimento: vencimentoNovo,
        },
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook Mercado Pago:", err);
    return res.sendStatus(500);
  }
}
export async function webhookMercadoPagoCobrancas(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const { type, data } = req.body || {};
    const paymentId = Number(data?.id);

    if (type !== "payment" || !paymentId) {
      return res.sendStatus(204);
    }

    const cobranca = await prisma.cobrancasFinanceiras.findFirst({
      where: { idCobranca: String(paymentId) },
    });

    if (!cobranca) {
      console.warn(`Cobrança ${paymentId} não encontrada`);
      return res.sendStatus(204);
    }

    const parametros = await prisma.parametrosConta.findUniqueOrThrow({
      where: { contaId: cobranca.contaId },
    });

    if (!parametros?.MercadoPagoApiKey) {
      console.warn(`Conta ${cobranca.contaId} sem chave Mercado Pago`);
      return res.sendStatus(204);
    }

    const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
    const payment = await mp.payment.get({ id: paymentId });

    const statusMap: Record<string, StatusPagamento> = {
      approved: "EFETIVADO",
      authorized: "EFETIVADO",
      cancelled: "CANCELADO",
      refunded: "ESTORNADO",
    };
    const paymentMethodMap: Record<string, MetodoPagamento> = {
      ticket: "BOLETO",
      bank_transfer: "PIX",
      atm: "OUTRO",
    };
    
    const statusNovo = statusMap[payment.status as string] ?? "PENDENTE";
    const metodoPago =
    paymentMethodMap[payment.payment_type_id as string] ?? "OUTRO";

    await prisma.cobrancasFinanceiras.update({
      where: { id: cobranca.id, contaId: cobranca.contaId },
      data: { status: statusNovo },
    });

    if (cobranca.lancamentoId && statusNovo === 'EFETIVADO') {
      await prisma.parcelaFinanceiro.update({
        where: { id: cobranca.lancamentoId },
        data: {
          pago: true,
          dataPagamento: new Date(),
          formaPagamento: metodoPago,
        },
      });
    }
    if (cobranca.vendaId && statusNovo === 'EFETIVADO') {
      const venda = await prisma.vendas.findUniqueOrThrow({
        where: { id: cobranca.vendaId, contaId: cobranca.contaId },
      })
      await prisma.vendas.update({
        where: { id: cobranca.vendaId },
        data: {
          faturado: true,
          status: "FATURADO",
          PagamentoVendas: {
            upsert: {
              create: {
                valor: venda.valor,
                data: new Date(),
                metodo: metodoPago,
                status: "EFETIVADO",
              },
              update: {
                metodo: metodoPago,
                data: new Date(),
                status: "EFETIVADO",
              }
            },
          },
        },
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook Mercado Pago:", err);
    res.sendStatus(500);
  }
}
