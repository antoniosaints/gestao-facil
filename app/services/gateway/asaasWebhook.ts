// src/controllers/webhookController.ts
import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";

export const receberWebhook = async (req: Request, res: Response) => {
  const evento = req.body.event;
  const data = req.body;

  try {
    switch (evento) {
      case "SUBSCRIPTION_CREATED":
        // você pode registrar o ID se necessário
        break;

      case "SUBSCRIPTION_CANCELLED":
        await prisma.contas.updateMany({
          where: { asaasSubscriptionId: data.subscription.id },
          data: { asaasSubscriptionId: null, status: "INATIVO" },
        });
        break;

      case "PAYMENT_RECEIVED":
        // você pode salvar um histórico ou atualizar o status
        console.log(`Pagamento recebido de ${data.customer.name}`);
        break;

      case "PAYMENT_OVERDUE":
        await prisma.contas.updateMany({
          where: { asaasCustomerId: data.customer },
          data: { status: "BLOQUEADO" },
        });
        break;

      case "PAYMENT_CONFIRMED":
        await prisma.contas.updateMany({
          where: { asaasSubscriptionId: data.customer },
          data: { status: "ATIVO" },
        });
        break;

      // outros eventos...
      default:
        console.log(`Evento não tratado: ${evento}`);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
    res.status(500).send("Erro interno");
  }
};
