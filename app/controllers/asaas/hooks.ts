import { addMonths, isBefore, isEqual, parseISO, subDays } from "date-fns";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { prisma } from "../../utils/prisma";

export function renovarVencimento(
  vencimento: string | Date,
  pagamento: string
): string {
  const dataVencimento =
    vencimento instanceof Date ? vencimento : parseISO(vencimento);
  const dataPagamento = parseISO(pagamento);

  let novaData: Date;

  if (isBefore(dataVencimento, dataPagamento)) {
    // Se já venceu, renova com base na data de pagamento
    novaData = addMonths(dataPagamento, 1);
  } else if (
    isEqual(dataVencimento, dataPagamento) ||
    isBefore(dataPagamento, dataVencimento)
  ) {
    // Ainda está válida, soma um mês à data de vencimento
    novaData = addMonths(dataVencimento, 1);
  } else {
    novaData = dataPagamento;
  }

  // Retorna no formato ISO completo com milissegundos (datetime(3))
  return novaData.toISOString();
}
export async function handleSubscriptionCreated(data: any) {
  await prisma.contas.updateMany({
    where: { asaasCustomerId: data.subscription.customer },
    data: {
      asaasSubscriptionId: data.subscription.id,
      vencimento: subDays(new Date(), 2),
      status: "BLOQUEADO",
    },
  });

  const conta = await prisma.contas.findFirst({
    where: { asaasCustomerId: data.subscription.customer },
  });

  if (!conta) return;

  await enqueuePushNotification(
    {
      title: "Assinatura criada",
      body: "Sua assinatura foi criada com sucesso.",
    },
    conta.id
  );
}
export async function handleSubscriptionCancelled(data: any) {
  await prisma.contas.updateMany({
    where: { asaasCustomerId: data.subscription.customer },
    data: {
      asaasSubscriptionId: null,
      vencimento: subDays(new Date(), 2),
      status: "INATIVO",
    },
  });

  const contaCanceledSubs = await prisma.contas.findFirst({
    where: {
      asaasCustomerId: data.subscription.customer,
    },
  });

  if (!contaCanceledSubs) return;

  await enqueuePushNotification(
    {
      title: "Assinatura cancelada",
      body: "Sua assinatura foi cancelada.",
    },
    contaCanceledSubs.id
  );
}
export async function handleSubscriptionDeleted(data: any) {
  await prisma.contas.updateMany({
    where: { asaasCustomerId: data.subscription.customer },
    data: {
      asaasSubscriptionId: null,
      vencimento: subDays(new Date(), 2),
      status: "INATIVO",
    },
  });

  const contaDeletedSubs = await prisma.contas.findFirst({
    where: {
      asaasCustomerId: data.subscription.customer,
    },
  });

  if (!contaDeletedSubs) return;

  await enqueuePushNotification(
    {
      title: "Assinatura deletada",
      body: "Sua assinatura foi deletada, verifique o status.",
    },
    contaDeletedSubs.id
  );
}
export async function handlePaymentCreated(data: any) {
  if (!data.payment.subscription) return;

  const contaCreated = await prisma.contas.findFirst({
    where: { asaasCustomerId: data.payment.customer },
  });

  if (!contaCreated) return;

  await prisma.faturasContas.create({
    data: {
      contaId: contaCreated.id,
      asaasPaymentId: data.payment.id,
      vencimento: parseISO(data.payment.dueDate),
      valor: parseFloat(data.payment.value),
      status: "PENDENTE",
      urlPagamento: data.payment.invoiceUrl,
    },
  });

  await enqueuePushNotification(
    {
      title: "Nova fatura criada",
      body: "Uma nova fatura foi criada para sua conta.",
    },
    contaCreated.id
  );
}
export async function handlePaymentDeleted(data: any) {
  if (!data.payment.subscription) return;

  const contaDeleted = await prisma.contas.findFirst({
    where: { asaasCustomerId: data.payment.customer },
  });

  if (!contaDeleted) return;

  await prisma.faturasContas.delete({
    where: { asaasPaymentId: data.payment.id },
  });

  await enqueuePushNotification(
    {
      title: "Fatura deletada",
      body: "Uma fatura foi deletada da sua conta.",
    },
    contaDeleted.id
  );
}
export async function handlePaymentOverdue(data: any) {
  if (!data.payment.subscription) return;

  const faturaOverdue = await prisma.faturasContas.findUnique({
    where: { asaasPaymentId: data.payment.id },
  });

  if (!faturaOverdue) return;

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
      vencimento: subDays(new Date(), 1), // força vencimento para ontem
    },
  });

  await enqueuePushNotification(
    {
      title: "Pagamento atrasado",
      body: `O pagamento da fatura ${faturaOverdue.id} está atrasado.`,
    },
    faturaOverdue.contaId
  );
}

export async function handlePagamentoEvento(data: any, titulo: string) {
  if (!data.payment.subscription) return;

  const fatura = await prisma.faturasContas.findUnique({
    where: { asaasPaymentId: data.payment.id },
  });

  if (!fatura) return;
  if (fatura.status === "PAGO") return;

  await prisma.faturasContas.update({
    where: { id: fatura.id },
    data: { status: "PAGO" },
  });

  const conta = await prisma.contas.findUnique({
    where: { id: fatura.contaId },
  });

  if (!conta) return;

  const novoVencimento = renovarVencimento(
    conta.vencimento,
    data.payment.confirmedDate
  );

  await prisma.contas.update({
    where: { id: fatura.contaId },
    data: {
      valor: parseFloat(data.payment.value),
      status: "ATIVO",
      vencimento: novoVencimento,
    },
  });

  await enqueuePushNotification(
    {
      title: titulo,
      body: `O pagamento da fatura ${fatura.id} foi ${titulo.toLowerCase()}.`,
    },
    fatura.contaId
  );
}
