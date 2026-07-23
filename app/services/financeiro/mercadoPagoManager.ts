import { prisma } from "../../utils/prisma";
import { tryGetTenantMercadoPagoService } from "./tenantMercadoPagoService";

export const cancelarCobrancaMP = async (contaId: number, paymentId: string): Promise<string | boolean> => {
  const parametros = await prisma.parametrosConta.findUniqueOrThrow({
    where: { contaId },
  });

  const mp = await tryGetTenantMercadoPagoService(contaId, parametros);

  if (!mp) {
    console.warn(`Conta ${contaId} sem credencial do Mercado Pago`);
    return `Conta ${contaId} sem credencial do Mercado Pago`;
  }

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
