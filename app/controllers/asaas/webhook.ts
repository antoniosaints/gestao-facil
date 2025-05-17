import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { env } from "../../utils/dotenv";
import { addMonths, parse, parseISO, subDays } from "date-fns";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";

export const webhookAsaasCheck = async (
  req: Request,
  res: Response
): Promise<any> => {
  const auth = req.headers["asaas-access-token"] as string;

  if (!auth || auth !== env.ASAAS_WEBHOOK_SECRET) {
    console.log(`Erro ao processar webhook: ${auth}`);
    return res.status(401).json({ error: "Assinatura do webhook inválida" });
  }

  console.log(`auth: ${auth}`);
  console.log(req.body);
  const evento = req.body.event;
  const data = req.body;

  try {
    switch (evento) {
      case "SUBSCRIPTION_CREATED":
        await prisma.contas.updateMany({
          where: { asaasCustomerId: data.subscription.customer },
          data: {
            asaasSubscriptionId: data.subscription.id,
            vencimento: subDays(new Date(), 1),
            status: "INATIVO",
          },
        });

        const contaCreatedSubs = await prisma.contas.findFirst({
          where: {
            asaasCustomerId: data.subscription.customer,
          },
        })

        if (!contaCreatedSubs) break;

        await enqueuePushNotification({
          title: "Assinatura criada",
          body: "Sua assinatura foi criada com sucesso.",
        }, contaCreatedSubs.id);

        break;

      case "SUBSCRIPTION_CANCELLED":
        await prisma.contas.updateMany({
          where: { asaasCustomerId: data.subscription.customer },
          data: {
            asaasSubscriptionId: null,
            vencimento: subDays(new Date(), 1),
            status: "INATIVO",
          },
        });

        const contaCanceledSubs = await prisma.contas.findFirst({
          where: {
            asaasCustomerId: data.subscription.customer,
          },
        })

        if (!contaCanceledSubs) break;

        await enqueuePushNotification({
          title: "Assinatura cancelada",
          body: "Sua assinatura foi cancelada.",
        }, contaCanceledSubs.id);

        break;

      case "SUBSCRIPTION_DELETED":
        await prisma.contas.updateMany({
          where: { asaasCustomerId: data.subscription.customer },
          data: {
            asaasSubscriptionId: null,
            vencimento: subDays(new Date(), 1),
            status: "INATIVO",
          },
        });

        const contaDeletedSubs = await prisma.contas.findFirst({
          where: {
            asaasCustomerId: data.subscription.customer,
          },
        })

        if (!contaDeletedSubs) break;

        await enqueuePushNotification({
          title: "Assinatura deletada",
          body: "Sua assinatura foi deletada, verifique o status.",
        }, contaDeletedSubs.id);

        break;

      case "PAYMENT_CREATED":
        if (!data.payment.subscription) break;

        const contaCreated = await prisma.contas.findFirst({
          where: { asaasCustomerId: data.payment.customer },
        });

        if (!contaCreated) break;

        await prisma.faturasContas.create({
          data: {
            contaId: contaCreated.id,
            asaasPaymentId: data.payment.id,
            vencimento: new Date(data.payment.dueDate),
            valor: parseFloat(data.payment.value),
            status: "PENDENTE",
            urlPagamento: data.payment.invoiceUrl,
          },
        });

        await enqueuePushNotification({
          title: "Nova fatura criada",
          body: "Uma nova fatura foi criada para sua conta.",
        }, contaCreated.id);
        break;
        
      case "PAYMENT_DELETED":
        if (!data.payment.subscription) break;

        const contaDeleted = await prisma.contas.findFirst({
          where: { asaasCustomerId: data.payment.customer },
        });

        if (!contaDeleted) break;

        await prisma.faturasContas.delete({
          where: { asaasPaymentId: data.payment.id },
        });

        await enqueuePushNotification({
          title: "Fatura deletada",
          body: "Uma fatura foi deletada da sua conta.",
        }, contaDeleted.id);

        break;

      case "PAYMENT_RECEIVED":
        if (!data.payment.subscription) break;
        const faturaReceived = await prisma.faturasContas.findUnique({
          where: { asaasPaymentId: data.payment.id },
        });

        if (!faturaReceived) break;

        await prisma.faturasContas.update({
          where: { id: faturaReceived.id },
          data: {
            status: "PAGO",
          },
        });

        await prisma.contas.update({
          where: { id: faturaReceived.contaId },
          data: {
            valor: parseFloat(data.payment.value),
            status: "ATIVO",
            vencimento: addMonths(parseISO(data.payment.confirmedDate), 1),
          },
        });

        await enqueuePushNotification({
          title: "Pagamento recebido",
          body: `O pagamento da fatura ${faturaReceived.id} foi recebido.`,
        }, faturaReceived.contaId);

        break;

      case "PAYMENT_OVERDUE":
        if (!data.payment.subscription) break;

        const faturaOverdue = await prisma.faturasContas.findUnique({
          where: { asaasPaymentId: data.payment.id },
        });

        if (!faturaOverdue) break;

        await prisma.faturasContas.update({
          where: { id: faturaOverdue.id },
          data: {
            status: "ATRASADO",
          },
        });

        await prisma.contas.update({
          where: { id: faturaOverdue.contaId },
          data: {
            valor: parseFloat(data.payment.value),
            status: "BLOQUEADO",
            vencimento: subDays(new Date(), 1),
          },
        });

        await enqueuePushNotification({
          title: "Pagamento atrasado",
          body: `O pagamento da fatura ${faturaOverdue.id} está atrasado.`,
        }, faturaOverdue.contaId);

        break;

      case "PAYMENT_CONFIRMED":
        if (!data.payment.subscription) break;
        const fatura = await prisma.faturasContas.findUnique({
          where: { asaasPaymentId: data.payment.id },
        });

        if (!fatura) break;

        await prisma.faturasContas.update({
          where: { id: fatura.id },
          data: {
            status: "PAGO",
          },
        });

        const nextDate = addMonths(parseISO(data.payment.confirmedDate), 1);
        await prisma.contas.update({
          where: { id: fatura.contaId },
          data: {
            valor: parseFloat(data.payment.value),
            status: "ATIVO",
            vencimento: nextDate,
          },
        });

        await enqueuePushNotification({
          title: "Pagamento confirmado",
          body: `O pagamento da fatura ${fatura.id} foi confirmado.`,
        }, fatura.contaId);

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
