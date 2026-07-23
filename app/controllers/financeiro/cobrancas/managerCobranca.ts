import { CobrancasFinanceiras, ParametrosConta } from "../../../../generated";
import { getTenantMercadoPagoService } from "../../../services/financeiro/tenantMercadoPagoService";
import { prisma } from "../../../utils/prisma";

export const cancelarCobrancaMercadoPago = async (
  parametros: ParametrosConta,
  cobranca: CobrancasFinanceiras
) => {
  const mp = await getTenantMercadoPagoService(parametros.contaId, parametros);
  const cancelamento = await mp.payment.cancel({
    id: cobranca.idCobranca,
  });

  if (cancelamento.status === "cancelled") {
    await prisma.cobrancasFinanceiras.update({
      where: { id: cobranca.id },
      data: { status: "CANCELADO" },
    });
  }

  return cancelamento.status;
};
export const estornarCobrancaMercadoPago = async (
  parametros: ParametrosConta,
  cobranca: CobrancasFinanceiras
) => {
  const mp = await getTenantMercadoPagoService(parametros.contaId, parametros);
  const estorno = await mp.refund.create({
    payment_id: cobranca.idCobranca,
  });

  if (estorno.status === "approved") {
    await prisma.cobrancasFinanceiras.update({
      where: { id: cobranca.id },
      data: { status: "ESTORNADO" },
    });
  }

  return estorno.status;
};
