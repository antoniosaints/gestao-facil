import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { MercadoPagoService } from "../../services/financeiro/mercadoPagoService";
import { ParametrosConta } from "../../../generated";
import { randomUUID } from "crypto";
interface BodyCobranca {
  type: "PIX" | "BOLETO" | "LINK";
  value: number;
  gateway: "mercadopago" | "pagseguro" | "asaas";
}
export const generateCobranca = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.body)
      return res
        .status(400)
        .json({ message: "Dados inválidos, informe o corpo da requisição." });
    const { type, value, gateway } = req.body as BodyCobranca;
    if (!type || !value || !gateway)
      return res.status(400).json({
        message:
          "Dados inválidos, informe o tipo de cobrança, o valor e a gateway",
      });

    const parametros = await prisma.parametrosConta.findFirst({
      where: {
        contaId: customData.contaId,
      },
    });

    if (!parametros)
      return res.status(400).json({
        message:
          "Parametros nao encontrados, informe os parametros da conta para continuar.",
      });

    if (gateway === "mercadopago") {
      const resp = await generateCobrancaMercadoPago(req.body, parametros);
      return res.status(200).json({ message: resp });
    }

    return res
      .status(200)
      .json({ message: "Cobranca gerada com sucesso." });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
};

const generateCobrancaMercadoPago = async (
  body: BodyCobranca,
  parametros: ParametrosConta
) => {
    if (!parametros.MercadoPagoApiKey)
      throw new Error(
        "API Key nao encontrada, adicione a chave do Mercado Pago."
      );

    const tipo = body.type;
    const mp = new MercadoPagoService(parametros.MercadoPagoApiKey);
    if (tipo === "LINK") {
      const link = await mp.preference.create({
        requestOptions: {
          idempotencyKey: String(parametros.contaId) + randomUUID(),
        },
        body: {
          items: [
            {
              id: randomUUID(),
              title: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
              quantity: 1,
              unit_price: body.value,
            },
          ],
          payer: {
            email: parametros.emailAvisos || "admin@userp.com.br",
          },
          back_urls: {
            success: `${process.env.BASE_URL_FRONTEND}/success?success=true`,
            failure: `${process.env.BASE_URL_FRONTEND}/success?success=false`,
            pending: `${process.env.BASE_URL_FRONTEND}/success?success=pending`,
          },
          notification_url: `${process.env.BASE_URL}/mercadopago/webhook`,
          external_reference: String(parametros.contaId) + "_link_cobranca",
          auto_return: "approved",
        },
      });

      return link.init_point;
    }
    else if (tipo === "PIX") {
      const link = await mp.payment.create({
        requestOptions: {
          idempotencyKey: String(parametros.contaId) + randomUUID(),
        },
        body: {
          payer: {
            email: parametros.emailAvisos || "admin@userp.com.br",
            entity_type: "individual",
          },
          external_reference: String(parametros.contaId) + "_pix_cobranca",
          transaction_amount: body.value,
          description: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
          payment_method_id: "pix",
          installments: 1,
          callback_url: `${process.env.BASE_URL}/mercadopago/webhook`,
          notification_url: `${process.env.BASE_URL}/mercadopago/webhook`,
        },
      });

      return link.point_of_interaction?.transaction_data?.ticket_url;
    }
    else if (tipo === "BOLETO") {
      const link = await mp.payment.create({
        requestOptions: {
          idempotencyKey: String(parametros.contaId) + randomUUID(),
        },
        body: {
          transaction_amount: body.value,
          description: `Cobrança gerada pelo sistema - Gestão Fácil - ERP`,
          payer: {
            email: parametros.emailAvisos || "admin@userp.com.br",
            first_name: "Cliente",
            last_name: "Gestão Fácil",
            entity_type: "individual",
            address: {
                city: "São Mateus do Maranhão",
                federal_unit: "MA",
                neighborhood: "Centro",
                street_name: "Rua dos Bobos",
                street_number: "0",
                zip_code: "65000-000"
            },
            type: "customer",
            identification: {
                type: "CPF",
                number: "07418262329"
            }
          },
          external_reference: String(parametros.contaId) + "_boleto_cobranca",
          payment_method_id: "bolbradesco",
          installments: 1,
          callback_url: `${process.env.BASE_URL}/mercadopago/webhook`,
          notification_url: `${process.env.BASE_URL}/mercadopago/webhook`,
        },
      });

      return link.transaction_details?.external_resource_url;
    }
    else {
      throw new Error("Tipo de cobranca nao encontrado.");
    }
};
