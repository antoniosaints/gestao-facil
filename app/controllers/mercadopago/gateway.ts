import { Request, Response } from "express";
import { mercadoPagoPreference } from "../../utils/mercadoPago";
import { randomUUID } from "crypto";

export async function criarLinkAssinatura(req: Request, res: Response): Promise<any> {
  try {
    const { nome, email, valor, externalId } = req.body;

    const payment = await mercadoPagoPreference.create({
      body: {
        items: [
          {
            id: randomUUID(),
            title: `Assinatura Mensal Gestaofacil - ${nome}`,
            quantity: 1,
            unit_price: Number(valor),
          },
        ],
        payer: {
          email,
        },
        back_urls: {
          success: "https://gestaofacil.tudoofertas.app.br?success=true",
          failure: "https://gestaofacil.tudoofertas.app.br?success=false",
          pending: "https://gestaofacil.tudoofertas.app.br?success=pending",
        },
        notification_url: "https://gestaofacil.tudoofertas.app.br/mercadopago/webhook",
        external_reference: externalId,
        auto_return: "approved",
      },
    });

    return res.json({ link: payment.init_point });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao gerar link de assinatura." });
  }
}
