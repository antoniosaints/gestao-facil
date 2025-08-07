import { Request, Response } from "express";
import { mercadoPagoPreference } from "../../utils/mercadoPago";
import { randomUUID } from "crypto";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";

export async function criarLinkAssinatura(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: customData.contaId },
    });
    const payment = await mercadoPagoPreference.create({
      body: {
        items: [
          {
            id: randomUUID(),
            title: `Mensalidade Gestao Fácil - ERP`,
            quantity: 1,
            unit_price: 70,
          },
        ],
        payer: {
          email: conta.email,
          name: conta.nome,
          identification: {
            number: String(conta.documento).replace(/[-.]/g, ""),
          },
        },
        back_urls: {
          success: `${env.BASE_URL}?success=true`,
          failure: `${env.BASE_URL}?success=false`,
          pending: `${env.BASE_URL}?success=pending`,
        },
        notification_url: `${env.BASE_URL}/mercadopago/webhook`,
        external_reference: String(customData.contaId),
        auto_return: "approved",
      },
    });

    return res.json({ link: payment.init_point });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao gerar link de assinatura." });
  }
}
