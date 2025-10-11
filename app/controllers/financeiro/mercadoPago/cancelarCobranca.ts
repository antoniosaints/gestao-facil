import { CobrancasFinanceiras, ParametrosConta } from "../../../../generated";
import { MercadoPagoService } from "../../../services/financeiro/mercadoPagoService";

export const cancelarCobrancaInterno = async (
  parametros: ParametrosConta,
  cobranca: CobrancasFinanceiras
) => {
  if (!parametros.MercadoPagoApiKey)
    throw new Error(
      "API Key nao encontrada, adicione a chave do Mercado Pago."
    );

  const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
  const cancelamento = await mp.payment.cancel({
    id: cobranca.idCobranca,
  });

  return cancelamento.status;
};
