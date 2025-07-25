import { Request, Response } from 'express';
import { mercadoPagoPayment } from '../../utils/mercadoPago';
import { prisma } from '../../utils/prisma';

export async function webhookMercadoPago(req: Request, res: Response) {
  try {
    const body = req.body;

    if (!body) return res.sendStatus(204);

    const { type, id } = body;

    if (type !== 'payment') return res.sendStatus(204);

    // Buscar detalhes do pagamento
    const payment = await mercadoPagoPayment.get({
        id: Number(id)
    });
    const { status, external_reference, transaction_amount } = payment;

    if (status === 'approved') {
      await prisma.faturasContas.updateMany({
        where: {
          asaasPaymentId: external_reference,
        },
        data: {
          status: 'PAGO',
        },
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error(err);
    return res.sendStatus(500);
  }
}
