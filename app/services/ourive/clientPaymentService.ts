import Decimal from "decimal.js";
import type { z } from "zod";
import type { clientPaymentSchema } from "./clientPaymentSchema";

const money = (value: unknown) =>
  new Decimal(String(value || 0)).toDecimalPlaces(2);

/** Substitui o total antecipado, preservando o isolamento por conta e o histórico. */
export async function saveClientPayment(
  db: any,
  actor: { contaId: number; userId: number },
  orderId: number,
  payment: z.infer<typeof clientPaymentSchema>,
) {
  return db.$transaction(async (tx: any) => {
    const order = await tx.ouriveOrdem.findFirst({
      where: { id: orderId, contaId: actor.contaId },
    });
    if (!order) return "order_not_found" as const;
    const reserved = await tx.ouriveOrdem.updateMany({
      where: { id: order.id, contaId: actor.contaId, faturadaEm: null },
      data: {
        antecipacaoCliente: money(payment.antecipacaoCliente),
        formaPagamentoCliente: payment.formaPagamentoCliente,
      },
    });
    if (!reserved.count) return "order_billed" as const;
    await tx.ouriveEvento.create({
      data: {
        ordemOuriveId: order.id,
        tipo: "FINANCEIRO",
        descricao: "Pagamento do cliente atualizado.",
        autorId: actor.userId,
        dados: {
          antecipacaoClienteAnterior: money(order.antecipacaoCliente).toFixed(
            2,
          ),
          antecipacaoCliente: money(payment.antecipacaoCliente).toFixed(2),
          formaPagamentoClienteAnterior: order.formaPagamentoCliente || null,
          formaPagamentoCliente: payment.formaPagamentoCliente,
        },
      },
    });
    return "updated" as const;
  });
}
