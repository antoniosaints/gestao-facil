import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { subDays } from "date-fns";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import {
  handlePagamentoEvento,
  handlePaymentCreated,
  handlePaymentDeleted,
  handlePaymentOverdue,
  handleSubscriptionCancelled,
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
} from "./hooks";

export const webhookAsaasCheck = async (
  req: Request,
  res: Response
): Promise<any> => {
  const auth = req.headers["asaas-access-token"] as string;

  if (!auth || auth !== env.ASAAS_WEBHOOK_SECRET) {
    console.log(`Erro ao processar webhook: ${auth}`);
    return res.status(401).json({ error: "Assinatura do webhook inválida" });
  }

  const evento = req.body.event;
  const data = req.body;

  try {
    switch (evento) {
      case "SUBSCRIPTION_CREATED":
        await handleSubscriptionCreated(data);
        break;

      case "SUBSCRIPTION_CANCELLED":
        await handleSubscriptionCancelled(data);
        break;

      case "SUBSCRIPTION_DELETED":
        await handleSubscriptionDeleted(data);
        break;

      case "PAYMENT_CREATED":
        await handlePaymentCreated(data);
        break;

      case "PAYMENT_DELETED":
        await handlePaymentDeleted(data);
        break;

      case "PAYMENT_RECEIVED":
        if (data.payment.billingType === "CREDIT_CARD") break; // CREDIT_CARD nao precisa receber
        await handlePagamentoEvento(data, "Pagamento recebido");
        break;

      case "PAYMENT_OVERDUE":
        await handlePaymentOverdue(data);
        break;

      case "PAYMENT_CONFIRMED":
        if (data.payment.billingType !== "CREDIT_CARD") break; // CREDIT_CARD nao precisa confirmar
        await handlePagamentoEvento(data, "Pagamento confirmado");
        break;

      default:
        console.log(`Evento não tratado: ${evento}`);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro ao processar webhook:", err);
    res.status(500).send("Erro interno");
  }
};
