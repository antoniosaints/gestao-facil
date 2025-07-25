import { Request, Response } from "express";
import { mercadoPagoPayment } from "../../utils/mercadoPago";
import { prisma } from "../../utils/prisma";
import { StatusFatura } from "../../../generated";
import { addDays, isBefore, parseISO } from "date-fns";

export async function webhookMercadoPago(req: Request, res: Response): Promise<any> {
  try {
    console.log(req.body);
    const { type, id, data } = req.body || {};
    if (type !== "payment" || !id) return res.sendStatus(204);

    const payment = await mercadoPagoPayment.get({ id: Number(data.id) });
    const { status, external_reference, transaction_amount } = payment;

    if (!external_reference) return res.sendStatus(204);
    const contaId = Number(external_reference);

    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: contaId },
    });

    const vencimentoConta = parseISO(conta.vencimento?.toString() || "");
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

    if (!faturaExistente) {
      await prisma.faturasContas.create({
        data: {
          asaasPaymentId: String(payment.id),
          urlPagamento: payment.point_of_interaction?.transaction_data?.ticket_url || "",
          valor: transaction_amount || 0,
          vencimento: vencimentoNovo.toDateString(),
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
          vencimento: vencimentoNovo.toDateString(),
        },
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook Mercado Pago:", err);
    return res.sendStatus(500);
  }
}
