import { addDays, startOfDay } from "date-fns";

import { Prisma } from "../../../generated/client";
import { prisma } from "../../utils/prisma";
import { formatCurrency, formatDateToPtBR } from "../../utils/formatters";
import {
  applyMensagemTemplate,
  computeDueOffset,
  DEFAULT_LEMBRETE_HORA,
  getEnabledChannels,
  getOffsetLabel,
  isChannelImplemented,
  MAX_DIA_OFFSET,
  resolveLembreteSchedule,
  type CanalLembreteInadimplencia,
  type LembreteConfigInput,
} from "./inadimplenciaLembretePolicy";
import { dispatchClienteReminder } from "./clienteReminderChannels";

/**
 * Motor dos lembretes de inadimplência voltados ao CLIENTE (menu Financeiro > Inadimplência).
 * Isolado do motor de marcos internos (financialDueNotificationService), é config-driven:
 * a agenda de cada parcela vem do override do lançamento, da config do cliente ou, na
 * ausência de ambos, do padrão legado (flag notificarClienteVencimento, com dias padrão da
 * conta). Dedup próprio em LembreteInadimplenciaEnviado. O worker roda de hora em hora e
 * cada conta só é processada na hora configurada (ParametrosConta.inadimplenciaHoraEnvio).
 */

type ReminderCandidate = {
  contaId: number;
  clienteId: number;
  parcelaId: number;
  diaOffset: number;
  dueDate: Date;
  canal: CanalLembreteInadimplencia;
  mensagem: string;
};

type ContaLembreteDefaults = {
  horaEnvio: number;
  enabled: boolean;
  defaultDias: Prisma.JsonValue | null;
  defaultMensagem: string | null;
};

export type InadimplenciaReminderSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

const CONFIG_SELECT = {
  ativo: true,
  diasLembrete: true,
  canalWhatsapp: true,
  canalEmail: true,
  canalSms: true,
  mensagemCustom: true,
} as const;

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function decimalToNumber(value: unknown) {
  return Number(value || 0);
}

function toConfigInput(row: {
  ativo: boolean;
  diasLembrete: Prisma.JsonValue;
  canalWhatsapp: boolean;
  canalEmail: boolean;
  canalSms: boolean;
  mensagemCustom: string | null;
} | null | undefined): LembreteConfigInput {
  if (!row) return null;
  return {
    ativo: row.ativo,
    diasLembrete: row.diasLembrete,
    canalWhatsapp: row.canalWhatsapp,
    canalEmail: row.canalEmail,
    canalSms: row.canalSms,
    mensagemCustom: row.mensagemCustom,
  };
}

function buildMensagem(args: {
  clienteNome: string;
  descricao: string;
  valor: number;
  dueDate: Date;
  offset: number;
  parcelaNumero: number;
  mensagemCustom: string | null;
  mensagemPadraoConta: string | null;
}): string {
  const vars = {
    cliente: args.clienteNome,
    descricao: args.descricao,
    valor: formatCurrency(args.valor),
    vencimento: formatDateToPtBR(args.dueDate),
    parcela: String(args.parcelaNumero),
  };

  // Prioridade: mensagem do próprio lembrete → template padrão da conta → texto de fábrica.
  const template = args.mensagemCustom || args.mensagemPadraoConta;
  if (template) {
    return applyMensagemTemplate(template, vars);
  }

  return [
    `Olá ${args.clienteNome}, este é um lembrete de pagamento (${getOffsetLabel(args.offset)}).`,
    `Lançamento: ${args.descricao}`,
    `Parcela: ${args.parcelaNumero}`,
    `Valor: ${vars.valor}`,
    `Vencimento: ${vars.vencimento}`,
  ].join("\n");
}

/** Defaults de lembrete por conta (hora, ativo, dias e mensagem padrão) das contas informadas. */
async function getContaDefaults(contaIds: number[]): Promise<Map<number, ContaLembreteDefaults>> {
  const rows = contaIds.length
    ? await prisma.parametrosConta.findMany({
        where: { contaId: { in: contaIds } },
        select: {
          contaId: true,
          financeiroVencimentosNotificacoesAtivo: true,
          inadimplenciaHoraEnvio: true,
          inadimplenciaDiasPadrao: true,
          inadimplenciaMensagemPadrao: true,
        },
      })
    : [];

  const map = new Map<number, ContaLembreteDefaults>();
  for (const row of rows) {
    map.set(row.contaId, {
      horaEnvio: row.inadimplenciaHoraEnvio ?? DEFAULT_LEMBRETE_HORA,
      enabled: row.financeiroVencimentosNotificacoesAtivo !== false,
      defaultDias: row.inadimplenciaDiasPadrao,
      defaultMensagem: row.inadimplenciaMensagemPadrao,
    });
  }
  return map;
}

function resolveContaDefaults(map: Map<number, ContaLembreteDefaults>, contaId: number): ContaLembreteDefaults {
  // Conta sem ParametrosConta → habilitada, hora padrão e sem template custom.
  return (
    map.get(contaId) ?? {
      horaEnvio: DEFAULT_LEMBRETE_HORA,
      enabled: true,
      defaultDias: null,
      defaultMensagem: null,
    }
  );
}

async function fetchPendingParcelas(today: Date) {
  // Janela: offset = hoje - vencimento, com offset ∈ [-60, 60] → vencimento em [-60, +60] dias.
  const windowStart = startOfDay(addDays(today, -MAX_DIA_OFFSET));
  const windowEnd = startOfDay(addDays(today, MAX_DIA_OFFSET + 1));

  return prisma.parcelaFinanceiro.findMany({
    where: {
      pago: false,
      vencimento: { gte: windowStart, lt: windowEnd },
      lancamento: {
        tipo: "RECEITA",
        clienteId: { not: null },
        OR: [
          { notificarClienteVencimento: true },
          { lembreteCliente: { isNot: null } },
          { cliente: { LembreteConfig: { isNot: null } } },
        ],
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
          notificarClienteVencimento: true,
          lembreteCliente: { select: CONFIG_SELECT },
          cliente: {
            select: {
              nome: true,
              LembreteConfig: { select: CONFIG_SELECT },
            },
          },
        },
      },
    },
  });
}

async function getReminderCandidates(today: Date): Promise<ReminderCandidate[]> {
  const currentHour = today.getHours();
  const parcelas = await fetchPendingParcelas(today);
  if (!parcelas.length) return [];

  const contaIds = Array.from(new Set(parcelas.map((p) => p.lancamento.contaId)));
  const contaDefaults = await getContaDefaults(contaIds);

  const candidates: ReminderCandidate[] = [];

  for (const parcela of parcelas) {
    const lancamento = parcela.lancamento;
    if (!lancamento.clienteId || !lancamento.cliente) continue;

    const defaults = resolveContaDefaults(contaDefaults, lancamento.contaId);
    // Gate de hora e do toggle geral da conta (feito uma vez por conta, aqui por candidato).
    if (!defaults.enabled) continue;
    if (defaults.horaEnvio !== currentHour) continue;

    const schedule = resolveLembreteSchedule({
      override: toConfigInput(lancamento.lembreteCliente),
      clienteConfig: toConfigInput(lancamento.cliente.LembreteConfig),
      legacyFlag: lancamento.notificarClienteVencimento,
      defaultDias: defaults.defaultDias,
    });
    if (!schedule) continue;

    const offset = computeDueOffset(parcela.vencimento, today);
    if (!schedule.dias.includes(offset)) continue;

    const canais = getEnabledChannels(schedule.canais).filter(isChannelImplemented);
    if (!canais.length) continue;

    const mensagem = buildMensagem({
      clienteNome: lancamento.cliente.nome,
      descricao: lancamento.descricao,
      valor: decimalToNumber(parcela.valor),
      dueDate: parcela.vencimento,
      offset,
      parcelaNumero: parcela.numero,
      mensagemCustom: schedule.mensagemCustom,
      mensagemPadraoConta: defaults.defaultMensagem,
    });

    for (const canal of canais) {
      candidates.push({
        contaId: lancamento.contaId,
        clienteId: lancamento.clienteId,
        parcelaId: parcela.id,
        diaOffset: offset,
        dueDate: parcela.vencimento,
        canal,
        mensagem,
      });
    }
  }

  return candidates;
}

async function markReminderSent(candidate: ReminderCandidate) {
  return prisma.lembreteInadimplenciaEnviado.create({
    data: {
      contaId: candidate.contaId,
      parcelaId: candidate.parcelaId,
      diaOffset: candidate.diaOffset,
      canal: candidate.canal,
      dataReferencia: startOfDay(candidate.dueDate),
    },
  });
}

async function unmarkReminder(candidate: ReminderCandidate) {
  await prisma.lembreteInadimplenciaEnviado.deleteMany({
    where: {
      parcelaId: candidate.parcelaId,
      diaOffset: candidate.diaOffset,
      canal: candidate.canal,
      dataReferencia: startOfDay(candidate.dueDate),
    },
  });
}

async function sendReminder(candidate: ReminderCandidate) {
  // Reserva o dedup ANTES de enviar (o unique index evita corrida/duplicidade). Se o
  // envio falhar, desfaz a reserva para permitir nova tentativa na próxima execução.
  await markReminderSent(candidate);

  try {
    await dispatchClienteReminder(candidate.canal, {
      contaId: candidate.contaId,
      clienteId: candidate.clienteId,
      mensagem: candidate.mensagem,
    });
  } catch (error) {
    await unmarkReminder(candidate);
    throw error;
  }
}

export async function processInadimplenciaReminders(
  today = new Date(),
): Promise<InadimplenciaReminderSummary> {
  const summary: InadimplenciaReminderSummary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const candidates = await getReminderCandidates(today);

  for (const candidate of candidates) {
    summary.checked += 1;

    try {
      await sendReminder(candidate);
      summary.sent += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        summary.skipped += 1;
        continue;
      }

      summary.failed += 1;
      summary.errors.push(
        `parcela:${candidate.parcelaId} offset:${candidate.diaOffset} - ${(error as Error)?.message || "Falha desconhecida"}`,
      );
    }
  }

  return summary;
}
