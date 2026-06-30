import { addDays, startOfDay } from "date-fns";
import { Prisma } from "../../../generated/client";
import { prisma } from "../../utils/prisma";
import { formatCurrency, formatDateToPtBR } from "../../utils/formatters";
import { enqueuePushNotification } from "../pushNotificationQueueService";
import { enqueueWhatsAppNotificationByPreference } from "../notifications/whatsappNotificationQueueService";
import { sendClienteWhatsappMessage } from "../clientes/clienteWhatsappService";
import {
  getFinancialDueMilestone,
  getFinancialDueMilestoneLabel,
  selectClientDueNotificationChannels,
  type ClientDueNotificationChannel,
  type FinancialDueNotificationMilestone,
  type FinancialDueNotificationSourceType,
} from "./financialDueNotificationPolicy";

type Candidate = {
  contaId: number;
  sourceType: FinancialDueNotificationSourceType;
  sourceId: number;
  dueDate: Date;
  title: string;
  body: string;
  target: "SYSTEM" | "CLIENT";
  channel?: ClientDueNotificationChannel;
  clienteId?: number | null;
};

type ProcessSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const TARGET_DAY_OFFSETS = [3, 1, 0, -1] as const;

function buildDateRanges(today: Date) {
  return TARGET_DAY_OFFSETS.map((offset) => {
    const start = startOfDay(addDays(today, offset));
    return {
      gte: start,
      lt: addDays(start, 1),
    };
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function decimalToNumber(value: unknown) {
  return Number(value || 0);
}

function buildPayload(args: {
  kindLabel: string;
  description: string;
  value: number;
  dueDate: Date;
  milestone: FinancialDueNotificationMilestone;
}) {
  const title = `Vencimento financeiro ${getFinancialDueMilestoneLabel(args.milestone)}`;
  const body = `${args.kindLabel}: ${args.description} no valor de ${formatCurrency(args.value)} vence em ${formatDateToPtBR(args.dueDate)}.`;
  return { title, body };
}

function buildClientPayload(args: {
  description: string;
  value: number;
  dueDate: Date;
  milestone: FinancialDueNotificationMilestone;
  parcelaNumero: number;
}) {
  const title = `Lembrete de pagamento ${getFinancialDueMilestoneLabel(args.milestone)}`;
  const body = [
    title,
    `Lancamento: ${args.description}`,
    `Parcela: ${args.parcelaNumero}`,
    `Valor: ${formatCurrency(args.value)}`,
    `Vencimento: ${formatDateToPtBR(args.dueDate)}`,
  ].join("\n");

  return { title, body };
}

async function getCandidates(today: Date): Promise<Candidate[]> {
  const dateRanges = buildDateRanges(today);
  const clientChannels = selectClientDueNotificationChannels();

  const [parcelas, parcelasCliente, assinaturas] = await Promise.all([
    prisma.parcelaFinanceiro.findMany({
      where: {
        pago: false,
        OR: dateRanges.map((range) => ({ vencimento: range })),
        lancamento: {
          notificarVencimento: true,
        },
      },
      select: {
        id: true,
        valor: true,
        vencimento: true,
        numero: true,
        lancamento: {
          select: {
            contaId: true,
            descricao: true,
            tipo: true,
          },
        },
      },
    }),
    prisma.parcelaFinanceiro.findMany({
      where: {
        pago: false,
        OR: dateRanges.map((range) => ({ vencimento: range })),
        lancamento: {
          notificarClienteVencimento: true,
          tipo: "RECEITA",
          clienteId: { not: null },
        },
      },
      select: {
        id: true,
        numero: true,
        valor: true,
        vencimento: true,
        lancamento: {
          select: {
            contaId: true,
            descricao: true,
            clienteId: true,
          },
        },
      },
    }),
    prisma.assinaturaPagar.findMany({
      where: {
        status: "ATIVA",
        notificarVencimento: true,
        OR: dateRanges.map((range) => ({ proximoVencimento: range })),
      },
      select: {
        id: true,
        contaId: true,
        nomeServico: true,
        valor: true,
        proximoVencimento: true,
      },
    }),
  ]);

  return [
    ...parcelas.map((parcela) => {
      const payload = buildPayload({
        kindLabel: parcela.lancamento.tipo === "DESPESA" ? "Despesa" : "Receita",
        description: parcela.lancamento.descricao,
        value: decimalToNumber(parcela.valor),
        dueDate: parcela.vencimento,
        milestone: getFinancialDueMilestone(parcela.vencimento, today) || "D0",
      });

      return {
        contaId: parcela.lancamento.contaId,
        sourceType: "LANCAMENTO_PARCELA" as const,
        sourceId: parcela.id,
        dueDate: parcela.vencimento,
        target: "SYSTEM" as const,
        ...payload,
      };
    }),
    ...parcelasCliente.flatMap((parcela) => {
      const milestone = getFinancialDueMilestone(parcela.vencimento, today) || "D0";
      const payload = buildClientPayload({
        description: parcela.lancamento.descricao,
        value: decimalToNumber(parcela.valor),
        dueDate: parcela.vencimento,
        milestone,
        parcelaNumero: parcela.numero,
      });

      return clientChannels.map((channel) => ({
        contaId: parcela.lancamento.contaId,
        sourceType: "CLIENTE_LANCAMENTO_PARCELA" as const,
        sourceId: parcela.id,
        dueDate: parcela.vencimento,
        target: "CLIENT" as const,
        channel,
        clienteId: parcela.lancamento.clienteId,
        ...payload,
      }));
    }),
    ...assinaturas
      .filter((assinatura) => assinatura.proximoVencimento)
      .map((assinatura) => {
        const dueDate = assinatura.proximoVencimento as Date;
        const payload = buildPayload({
          kindLabel: "Assinatura a pagar",
          description: assinatura.nomeServico,
          value: decimalToNumber(assinatura.valor),
          dueDate,
          milestone: getFinancialDueMilestone(dueDate, today) || "D0",
        });

        return {
          contaId: assinatura.contaId,
          sourceType: "ASSINATURA_PAGAR" as const,
          sourceId: assinatura.id,
          dueDate,
          target: "SYSTEM" as const,
          ...payload,
        };
      }),
  ];
}

async function isAccountFinancialDueNotificationEnabled(contaId: number) {
  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { financeiroVencimentosNotificacoesAtivo: true },
  });

  return parametros?.financeiroVencimentosNotificacoesAtivo !== false;
}

async function markAsSent(candidate: Candidate, milestone: FinancialDueNotificationMilestone) {
  return prisma.notificacaoVencimentoFinanceiro.create({
    data: {
      contaId: candidate.contaId,
      origemTipo: candidate.sourceType,
      origemId: candidate.sourceId,
      marco: milestone,
      canal: candidate.channel || "WHATSAPP",
      dataReferencia: startOfDay(candidate.dueDate),
    },
  });
}

async function unmarkClientSendFailure(candidate: Candidate, milestone: FinancialDueNotificationMilestone) {
  if (candidate.target !== "CLIENT") return;

  await prisma.notificacaoVencimentoFinanceiro.deleteMany({
    where: {
      contaId: candidate.contaId,
      origemTipo: candidate.sourceType,
      origemId: candidate.sourceId,
      marco: milestone,
      canal: candidate.channel || "WHATSAPP",
      dataReferencia: startOfDay(candidate.dueDate),
    },
  });
}

async function sendCandidate(candidate: Candidate, milestone: FinancialDueNotificationMilestone) {
  await markAsSent(candidate, milestone);

  if (candidate.target === "CLIENT") {
    try {
      if (candidate.channel === "WHATSAPP" && candidate.clienteId) {
        await sendClienteWhatsappMessage(candidate.contaId, candidate.clienteId, {
          tipo: "MENSAGEM",
          mensagem: candidate.body,
        });
      }
    } catch (error) {
      await unmarkClientSendFailure(candidate, milestone);
      throw error;
    }

    return;
  }

  await Promise.all([
    enqueuePushNotification({ title: candidate.title, body: candidate.body }, candidate.contaId, true),
    enqueueWhatsAppNotificationByPreference(
      "VENCIMENTO_FINANCEIRO",
      { title: candidate.title, body: candidate.body },
      candidate.contaId,
    ),
  ]);
}

export async function processFinancialDueNotifications(today = new Date()): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const candidates = await getCandidates(today);

  for (const candidate of candidates) {
    summary.checked += 1;

    const milestone = getFinancialDueMilestone(candidate.dueDate, today);
    if (!milestone) {
      summary.skipped += 1;
      continue;
    }

    try {
      const enabled = await isAccountFinancialDueNotificationEnabled(candidate.contaId);
      if (!enabled) {
        summary.skipped += 1;
        continue;
      }

      await sendCandidate(candidate, milestone);
      summary.sent += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        summary.skipped += 1;
        continue;
      }

      summary.failed += 1;
      summary.errors.push(`${candidate.sourceType}:${candidate.sourceId} - ${(error as Error)?.message || "Falha desconhecida"}`);
    }
  }

  return summary;
}
