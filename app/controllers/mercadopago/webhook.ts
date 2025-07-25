import { Request, Response } from "express";
import { mercadoPagoPayment } from "../../utils/mercadoPago";
import { prisma } from "../../utils/prisma";
import { StatusFatura } from "../../../generated";
import { addDays, addHours, isBefore } from "date-fns";

export async function getPaymentMercadoPago(req: Request, res: Response) {
  try {
    const { id } = req.query;
    const payment = await mercadoPagoPayment.get({ id: Number(id) });
    res.status(200).json(payment);
  }catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

export async function webhookMercadoPago(req: Request, res: Response): Promise<any> {
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
    if (["approved", "authorized"].includes(status as string)) statusFatura = "PAGO";
    if (["cancelled", "refunded"].includes(status as string)) statusFatura = "CANCELADO";

    const faturaExistente = await prisma.faturasContas.findFirst({
      where: {
        contaId,
        asaasPaymentId: String(payment.id),
      },
    });

    let link_pagamento: string = "";
    if (payment.payment_type_id === "ticket") {
      link_pagamento = payment.transaction_details?.external_resource_url as string;
    }else {
      link_pagamento = payment.point_of_interaction?.transaction_data?.ticket_url as string;
    }

    if (!faturaExistente && payment.point_of_interaction?.transaction_data?.ticket_url != "") {
      await prisma.faturasContas.create({
        data: {
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
