import { addDays, startOfDay } from "date-fns";
import { Prisma } from "../../../generated/client";
import { prisma } from "../../utils/prisma";
import { formatCurrency, formatDateToPtBR } from "../../utils/formatters";
import { enqueuePushNotification } from "../pushNotificationQueueService";
import { enqueueWhatsAppNotificationByPreference } from "../notifications/whatsappNotificationQueueService";
import {
  getFinancialDueMilestone,
  getFinancialDueMilestoneLabel,
  type FinancialDueNotificationMilestone,
  type FinancialDueNotificationSourceType,
} from "./financialDueNotificationPolicy";

/**
 * Motor de notificação INTERNA de vencimentos financeiros (avisa a equipe: root/admin).
 * Usa marcos fixos [3, 1, 0, -1] dias → D3/D1/D0/D1_APOS.
 *
 * Os lembretes voltados ao CLIENTE (inadimplência) foram movidos para
 * inadimplenciaReminderService.ts, que é config-driven (agenda por cliente/lançamento).
 */

type Candidate = {
  contaId: number;
  sourceType: FinancialDueNotificationSourceType;
  sourceId: number;
  dueDate: Date;
  title: string;
  body: string;
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

async function getCandidates(today: Date): Promise<Candidate[]> {
  const dateRanges = buildDateRanges(today);

  const [parcelas, assinaturas] = await Promise.all([
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
        ...payload,
      };
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
      canal: "WHATSAPP",
      dataReferencia: startOfDay(candidate.dueDate),
    },
  });
}

async function sendCandidate(candidate: Candidate, milestone: FinancialDueNotificationMilestone) {
  await markAsSent(candidate, milestone);

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
