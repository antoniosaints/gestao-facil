import { prisma } from "../../utils/prisma";
import { MercadoPagoService } from "./mercadoPagoService";

export const cancelarCobrancaMP = async (contaId: number, paymentId: string): Promise<string | boolean> => {
  const parametros = await prisma.parametrosConta.findUniqueOrThrow({
    where: { contaId },
  });

  if (!parametros?.MercadoPagoApiKey) {
    console.warn(`Conta ${contaId} sem chave Mercado Pago`);
    return `Conta ${contaId} sem chave Mercado Pago`;
  }

  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  const payment = await mp.payment.get({ id: paymentId });

  if (!payment) {
    console.warn(`Cobrança ${paymentId} nao encontrada`);
    return `Cobrança ${paymentId} nao encontrada`;
  }

  const cancelamento = await mp.payment.cancel({ id: paymentId });

  if (cancelamento.status === "cancelled") {
    return true;
  }

  return false;
};
