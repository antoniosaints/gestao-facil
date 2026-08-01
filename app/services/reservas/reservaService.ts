import { createHash, createHmac, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import {
  MetodoPagamento,
  Prisma,
  ReservaNotificacaoEvento,
  ReservaPagamentoStatus,
  ReservaPoliticaPagamento,
  ReservaStatus,
} from "../../../generated";
import { env } from "../../utils/dotenv";
import { prisma } from "../../utils/prisma";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { getTenantMercadoPagoService } from "../financeiro/tenantMercadoPagoService";
import { contaHasActiveModule } from "../contas/storeModulesService";
import {
  buildMercadoPagoChargeReference,
  buildMercadoPagoOperationalWebhookUrl,
} from "../financeiro/mercadoPagoChargeReference";
import { enqueueWhatsAppReservationMessage } from "../notifications/whatsappNotificationQueueService";
import {
  assertCanceledReservationCanBeDeleted,
  assertReservationTransition,
  calculateReservationPayment,
  canChangePublicReservation,
  normalizeReservationPhone,
  renderReservationTemplate,
} from "./reservaPolicy";

type Db = Prisma.TransactionClient | typeof prisma;

const ACTIVE_STATUSES: ReservaStatus[] = [
  ReservaStatus.AGUARDANDO_PAGAMENTO,
  ReservaStatus.CONFIRMADA,
];

const DEFAULT_TEMPLATES = {
  pending:
    "Olá {cliente}! Sua reserva de {servico} está aguardando pagamento. Finalize aqui: {link_pagamento}",
  confirmed:
    "Reserva confirmada, {cliente}! {servico} com {recurso} em {data} às {hora}. Acompanhe: {link_reserva}",
  reminder:
    "Olá {cliente}, seu horário de {servico} está chegando: {data} às {hora}, com {recurso}.",
  after:
    "Obrigado pela confiança, {cliente}! Esperamos que tenha gostado de {servico}.",
};

const BOOKING_INCLUDE = {
  ServicoConfig: { include: { Servico: true } },
  Recurso: true,
  Cliente: true,
  Pagamentos: { orderBy: { createdAt: "desc" as const } },
  Notificacoes: { orderBy: { agendadaPara: "asc" as const } },
  Historico: { orderBy: { createdAt: "desc" as const } },
  LancamentoFinanceiro: { include: { parcelas: true } },
} satisfies Prisma.ReservaGeralInclude;

export interface ReservationCustomerInput {
  name: string;
  phone: string;
  email?: string;
}

export interface ReservationCreateInput {
  serviceConfigId: number;
  resourceId?: number | null;
  startAt: Date;
  customer: ReservationCustomerInput;
  acceptedTerms: boolean;
  operationalConsent?: boolean;
  afterSalesConsent?: boolean;
  notes?: string;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function managementToken(contaId: number, idempotencyKey: string) {
  const secret = env.LOJA_CUSTOMER_JWT_SECRET || env.JWT_SECRET;
  return createHmac("sha256", secret)
    .update(`reserva:${contaId}:${idempotencyKey}`)
    .digest("base64url");
}

function publicManagementUrl(slug: string, publicId: string, token?: string) {
  const base = `${env.BASE_URL_FRONTEND}/reservar/${slug}/reserva/${publicId}`;
  return token ? `${base}#token=${encodeURIComponent(token)}` : base;
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function notificationVariables(
  booking: {
    nomeCliente: string;
    servicoNome: string;
    recursoNome: string;
    inicio: Date;
    valorTotal: Decimal.Value;
    publicId: string;
    Pagamentos?: Array<{ linkPagamento: string | null }>;
  },
  config: { slug: string; timezone: string },
  companyName: string,
) {
  const parts = dateParts(booking.inicio, config.timezone);
  return {
    cliente: booking.nomeCliente,
    empresa: companyName,
    servico: booking.servicoNome,
    recurso: booking.recursoNome,
    data: `${parts.day}/${parts.month}/${parts.year}`,
    hora: `${parts.hour}:${parts.minute}`,
    valor: new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(booking.valorTotal)),
    link_pagamento: booking.Pagamentos?.[0]?.linkPagamento || "",
    link_reserva: publicManagementUrl(config.slug, booking.publicId),
  };
}

async function createUniqueSlug(contaId: number, name: string) {
  const base = slugify(name) || `reservas-${contaId}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${contaId}${attempt > 1 ? `-${attempt}` : ""}`;
    const exists = await prisma.reservaConfig.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  return `reservas-${contaId}-${randomUUID().slice(0, 8)}`;
}

export async function ensureReservationConfig(contaId: number) {
  const existing = await prisma.reservaConfig.findUnique({ where: { contaId } });
  if (existing) return existing;
  const account = await prisma.contas.findUniqueOrThrow({
    where: { id: contaId },
    select: { nome: true, nomeFantasia: true },
  });
  return prisma.reservaConfig.create({
    data: {
      contaId,
      slug: await createUniqueSlug(contaId, account.nomeFantasia || account.nome),
      titulo: `Reserve seu horário com ${account.nomeFantasia || account.nome}`,
      whatsappPendenteTemplate: DEFAULT_TEMPLATES.pending,
      whatsappConfirmadaTemplate: DEFAULT_TEMPLATES.confirmed,
      whatsappLembreteTemplate: DEFAULT_TEMPLATES.reminder,
      whatsappPosVendaTemplate: DEFAULT_TEMPLATES.after,
      secoes: ["apresentacao", "servicos", "agenda", "termos"],
    },
  });
}

export async function updateReservationConfig(
  contaId: number,
  data: Prisma.ReservaConfigUncheckedUpdateInput,
) {
  const current = await ensureReservationConfig(contaId);
  const allowed = {
    slug: data.slug,
    ativo: data.ativo,
    timezone: data.timezone,
    antecedenciaMinimaMinutos: data.antecedenciaMinimaMinutos,
    horizonteDias: data.horizonteDias,
    expiracaoPagamentoMinutos: data.expiracaoPagamentoMinutos,
    antecedenciaRemarcacaoHoras: data.antecedenciaRemarcacaoHoras,
    antecedenciaCancelamentoHoras: data.antecedenciaCancelamentoHoras,
    titulo: data.titulo,
    descricao: data.descricao,
    bannerUrl: data.bannerUrl,
    corPrimaria: data.corPrimaria,
    corSecundaria: data.corSecundaria,
    termos: data.termos,
    themeConfig: data.themeConfig,
    secoes: data.secoes,
    lancamentoAutomatico: data.lancamentoAutomatico,
    categoriaFinanceiraId: data.categoriaFinanceiraId,
    contaFinanceiraId: data.contaFinanceiraId,
    whatsappPendenteAtivo: data.whatsappPendenteAtivo,
    whatsappPendenteTemplate: data.whatsappPendenteTemplate,
    whatsappConfirmadaAtivo: data.whatsappConfirmadaAtivo,
    whatsappConfirmadaTemplate: data.whatsappConfirmadaTemplate,
    whatsappLembreteAtivo: data.whatsappLembreteAtivo,
    whatsappLembreteHoras: data.whatsappLembreteHoras,
    whatsappLembreteTemplate: data.whatsappLembreteTemplate,
    whatsappPosVendaAtivo: data.whatsappPosVendaAtivo,
    whatsappPosVendaHoras: data.whatsappPosVendaHoras,
    whatsappPosVendaTemplate: data.whatsappPosVendaTemplate,
  };

  for (const template of [
    allowed.whatsappPendenteTemplate,
    allowed.whatsappConfirmadaTemplate,
    allowed.whatsappLembreteTemplate,
    allowed.whatsappPosVendaTemplate,
  ]) {
    if (typeof template === "string") {
      renderReservationTemplate(template, {});
    }
  }

  if (allowed.lancamentoAutomatico) {
    if (!allowed.categoriaFinanceiraId || !allowed.contaFinanceiraId) {
      throw new Error("Informe a categoria e a conta financeira das reservas.");
    }
    const [category, account] = await Promise.all([
      prisma.categoriaFinanceiro.findFirst({
        where: { id: Number(allowed.categoriaFinanceiraId), contaId },
        select: { id: true },
      }),
      prisma.contasFinanceiro.findFirst({
        where: { id: Number(allowed.contaFinanceiraId), contaId },
        select: { id: true },
      }),
    ]);
    if (!category || !account) throw new Error("Categoria ou conta financeira inválida.");
  }

  return prisma.reservaConfig.update({
    where: { id: current.id, contaId },
    data: allowed,
  });
}

export async function listReservationResources(contaId: number, publicOnly = false) {
  return prisma.reservaRecurso.findMany({
    where: {
      contaId,
      ativo: true,
      ...(publicOnly ? { publico: true } : {}),
    },
    include: { Disponibilidades: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
  });
}

export async function saveReservationResource(
  contaId: number,
  input: {
    id?: number;
    nome: string;
    descricao?: string | null;
    tipo: "PROFISSIONAL" | "SALA" | "EQUIPAMENTO";
    ativo?: boolean;
    publico?: boolean;
    ordem?: number;
  },
) {
  if (input.id) {
    const exists = await prisma.reservaRecurso.findFirst({
      where: { id: input.id, contaId },
      select: { id: true },
    });
    if (!exists) throw new Error("Recurso não encontrado.");
    return prisma.reservaRecurso.update({
      where: { id: input.id },
      data: {
        nome: input.nome,
        descricao: input.descricao,
        tipo: input.tipo,
        ativo: input.ativo,
        publico: input.publico,
        ordem: input.ordem,
      },
    });
  }
  return prisma.reservaRecurso.create({
    data: {
      contaId,
      nome: input.nome,
      descricao: input.descricao,
      tipo: input.tipo,
      ativo: input.ativo ?? true,
      publico: input.publico ?? true,
      ordem: input.ordem ?? 0,
      Disponibilidades: {
        create: [1, 2, 3, 4, 5].map((diaSemana) => ({
          contaId,
          diaSemana,
          inicioMinuto: 8 * 60,
          fimMinuto: 18 * 60,
        })),
      },
    },
    include: { Disponibilidades: true },
  });
}

export async function replaceResourceAvailability(
  contaId: number,
  resourceId: number,
  ranges: Array<{ weekday: number; startMinute: number; endMinute: number }>,
) {
  const resource = await prisma.reservaRecurso.findFirst({
    where: { id: resourceId, contaId },
    select: { id: true },
  });
  if (!resource) throw new Error("Recurso não encontrado.");
  for (const range of ranges) {
    if (
      range.weekday < 0 ||
      range.weekday > 6 ||
      range.startMinute < 0 ||
      range.endMinute > 1440 ||
      range.startMinute >= range.endMinute
    ) {
      throw new Error("Faixa de disponibilidade inválida.");
    }
  }
  return prisma.$transaction(async (tx) => {
    await tx.reservaDisponibilidade.deleteMany({ where: { contaId, recursoId: resourceId } });
    if (ranges.length) {
      await tx.reservaDisponibilidade.createMany({
        data: ranges.map((range) => ({
          contaId,
          recursoId: resourceId,
          diaSemana: range.weekday,
          inicioMinuto: range.startMinute,
          fimMinuto: range.endMinute,
        })),
      });
    }
    return tx.reservaDisponibilidade.findMany({
      where: { contaId, recursoId: resourceId },
      orderBy: [{ diaSemana: "asc" }, { inicioMinuto: "asc" }],
    });
  });
}

export async function saveScheduleException(
  contaId: number,
  input: {
    id?: number;
    resourceId: number;
    startAt: Date;
    endAt: Date;
    type: "DISPONIVEL" | "BLOQUEADO";
    reason?: string | null;
  },
) {
  if (input.endAt <= input.startAt) throw new Error("O fim da exceção deve ser posterior ao início.");
  const resource = await prisma.reservaRecurso.findFirst({
    where: { id: input.resourceId, contaId },
    select: { id: true },
  });
  if (!resource) throw new Error("Recurso não encontrado.");
  return input.id
    ? prisma.reservaExcecaoAgenda.update({
        where: { id: input.id, contaId },
        data: {
          recursoId: input.resourceId,
          inicio: input.startAt,
          fim: input.endAt,
          tipo: input.type,
          motivo: input.reason,
        },
      })
    : prisma.reservaExcecaoAgenda.create({
        data: {
          contaId,
          recursoId: input.resourceId,
          inicio: input.startAt,
          fim: input.endAt,
          tipo: input.type,
          motivo: input.reason,
        },
      });
}

export async function listScheduleExceptions(contaId: number, resourceId?: number) {
  return prisma.reservaExcecaoAgenda.findMany({
    where: { contaId, ...(resourceId ? { recursoId: resourceId } : {}) },
    include: { Recurso: { select: { id: true, nome: true } } },
    orderBy: { inicio: "asc" },
  });
}

export async function deleteScheduleException(contaId: number, exceptionId: number) {
  const deleted = await prisma.reservaExcecaoAgenda.deleteMany({
    where: { id: exceptionId, contaId },
  });
  if (!deleted.count) throw new Error("Exceção de agenda não encontrada.");
  return { id: exceptionId };
}

export async function deleteReservationResource(contaId: number, resourceId: number) {
  const resource = await prisma.reservaRecurso.findFirst({
    where: { id: resourceId, contaId },
    select: {
      id: true,
      Servicos: { select: { servicoConfigId: true } },
      _count: { select: { Reservas: true } },
    },
  });
  if (!resource) throw new Error("Recurso não encontrado.");
  if (resource._count.Reservas > 0) {
    throw new Error("Este recurso possui reservas vinculadas e não pode ser excluído.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.reservaRecurso.delete({ where: { id: resource.id } });
    const linkedServiceIds = resource.Servicos.map((item) => item.servicoConfigId);
    if (!linkedServiceIds.length) return;
    const orphanedServices = await tx.reservaServicoConfig.findMany({
      where: {
        contaId,
        id: { in: linkedServiceIds },
        Recursos: { none: {} },
      },
      select: { id: true },
    });
    if (orphanedServices.length) {
      await tx.reservaServicoConfig.updateMany({
        where: { id: { in: orphanedServices.map((item) => item.id) }, contaId },
        data: { ativo: false, publico: false },
      });
    }
  });
  return { id: resource.id };
}

export async function listReservationServiceConfigs(contaId: number, publicOnly = false) {
  return prisma.reservaServicoConfig.findMany({
    where: {
      contaId,
      ...(publicOnly ? { ativo: true, publico: true, Servico: { status: true } } : {}),
    },
    include: {
      Servico: true,
      Recursos: { include: { Recurso: true } },
    },
    orderBy: { Servico: { nome: "asc" } },
  });
}

export async function saveReservationServiceConfig(
  contaId: number,
  input: {
    serviceId: number;
    durationMinutes: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    paymentPolicy: ReservaPoliticaPagamento;
    fixedDeposit?: number | null;
    percentageDeposit?: number | null;
    active?: boolean;
    public?: boolean;
    allowAnyResource?: boolean;
    resourceIds: number[];
  },
) {
  if (input.durationMinutes < 5 || input.durationMinutes > 24 * 60) {
    throw new Error("A duração deve ficar entre 5 minutos e 24 horas.");
  }
  const service = await prisma.servicos.findFirst({
    where: { id: input.serviceId, contaId },
    select: { id: true, preco: true },
  });
  if (!service) throw new Error("Serviço não encontrado.");
  const resourceCount = await prisma.reservaRecurso.count({
    where: { id: { in: input.resourceIds }, contaId, ativo: true },
  });
  if (!input.resourceIds.length || resourceCount !== new Set(input.resourceIds).size) {
    throw new Error("Selecione ao menos um recurso válido.");
  }
  calculateReservationPayment({
    total: service.preco,
    policy: input.paymentPolicy,
    fixedDeposit: input.fixedDeposit,
    percentageDeposit: input.percentageDeposit,
  });

  return prisma.$transaction(async (tx) => {
    const config = await tx.reservaServicoConfig.upsert({
      where: { servicoId: input.serviceId },
      create: {
        contaId,
        servicoId: input.serviceId,
        duracaoMinutos: input.durationMinutes,
        intervaloAntesMinutos: input.bufferBeforeMinutes || 0,
        intervaloDepoisMinutos: input.bufferAfterMinutes || 0,
        politicaPagamento: input.paymentPolicy,
        valorSinal: input.fixedDeposit,
        percentualSinal: input.percentageDeposit,
        ativo: input.active ?? true,
        publico: input.public ?? true,
        permitirQualquerRecurso: input.allowAnyResource ?? true,
      },
      update: {
        contaId,
        duracaoMinutos: input.durationMinutes,
        intervaloAntesMinutos: input.bufferBeforeMinutes || 0,
        intervaloDepoisMinutos: input.bufferAfterMinutes || 0,
        politicaPagamento: input.paymentPolicy,
        valorSinal: input.fixedDeposit,
        percentualSinal: input.percentageDeposit,
        ativo: input.active ?? true,
        publico: input.public ?? true,
        permitirQualquerRecurso: input.allowAnyResource ?? true,
      },
    });
    await tx.reservaServicoRecurso.deleteMany({
      where: { contaId, servicoConfigId: config.id },
    });
    await tx.reservaServicoRecurso.createMany({
      data: Array.from(new Set(input.resourceIds)).map((resourceId) => ({
        contaId,
        servicoConfigId: config.id,
        recursoId: resourceId,
      })),
    });
    return tx.reservaServicoConfig.findUniqueOrThrow({
      where: { id: config.id },
      include: { Servico: true, Recursos: { include: { Recurso: true } } },
    });
  });
}

export async function deleteReservationServiceConfig(contaId: number, serviceConfigId: number) {
  const serviceConfig = await prisma.reservaServicoConfig.findFirst({
    where: { id: serviceConfigId, contaId },
    select: { id: true, _count: { select: { Reservas: true } } },
  });
  if (!serviceConfig) throw new Error("Serviço reservável não encontrado.");
  if (serviceConfig._count.Reservas > 0) {
    throw new Error("Este serviço possui reservas vinculadas e não pode ser excluído.");
  }
  await prisma.reservaServicoConfig.delete({ where: { id: serviceConfig.id } });
  return { id: serviceConfig.id };
}

function dateRange(start: string, end: string) {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime()) || last < first) {
    throw new Error("Período de disponibilidade inválido.");
  }
  const days = Math.floor((last.getTime() - first.getTime()) / 86400000) + 1;
  if (days > 31) throw new Error("Consulte no máximo 31 dias por vez.");
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first.getTime() + index * 86400000);
    return date.toISOString().slice(0, 10);
  });
}

function zonedDate(date: string, minute: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const minutePart = minute % 60;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minutePart);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const represented = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  );
  return new Date(utcGuess - (represented - utcGuess));
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

async function resourceIsFree(
  db: Db,
  contaId: number,
  resourceId: number,
  startAt: Date,
  endAt: Date,
  beforeMinutes: number,
  afterMinutes: number,
  ignoreReservationId?: number,
) {
  const wantedStart = new Date(startAt.getTime() - beforeMinutes * 60000);
  const wantedEnd = new Date(endAt.getTime() + afterMinutes * 60000);
  const existing = await db.reservaGeral.findMany({
    where: {
      contaId,
      recursoId: resourceId,
      status: { in: ACTIVE_STATUSES },
      inicio: { lt: new Date(wantedEnd.getTime() + 24 * 60 * 60000) },
      fim: { gt: new Date(wantedStart.getTime() - 24 * 60 * 60000) },
      ...(ignoreReservationId ? { id: { not: ignoreReservationId } } : {}),
    },
    include: { ServicoConfig: true },
  });
  return !existing.some((booking) => {
    const busyStart = new Date(
      booking.inicio.getTime() - booking.ServicoConfig.intervaloAntesMinutos * 60000,
    );
    const busyEnd = new Date(
      booking.fim.getTime() + booking.ServicoConfig.intervaloDepoisMinutos * 60000,
    );
    return overlaps(wantedStart, wantedEnd, busyStart, busyEnd);
  });
}

async function resourceAllowsTime(
  db: Db,
  contaId: number,
  resourceId: number,
  startAt: Date,
  endAt: Date,
  timeZone: string,
) {
  const start = dateParts(startAt, timeZone);
  const end = dateParts(endAt, timeZone);
  const localDate = `${start.year}-${start.month}-${start.day}`;
  const endLocalDate = `${end.year}-${end.month}-${end.day}`;
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay();
  const startMinute = Number(start.hour) % 24 * 60 + Number(start.minute);
  const endMinute = endLocalDate === localDate
    ? Number(end.hour) % 24 * 60 + Number(end.minute)
    : 1440;
  const exceptions = await db.reservaExcecaoAgenda.findMany({
    where: {
      contaId,
      recursoId: resourceId,
      inicio: { lt: endAt },
      fim: { gt: startAt },
    },
  });
  if (exceptions.some((exception) => exception.tipo === "BLOQUEADO")) return false;
  if (
    exceptions.some(
      (exception) =>
        exception.tipo === "DISPONIVEL" &&
        exception.inicio <= startAt &&
        exception.fim >= endAt,
    )
  ) return true;
  const range = await db.reservaDisponibilidade.findFirst({
    where: {
      contaId,
      recursoId: resourceId,
      diaSemana: weekday,
      ativo: true,
      inicioMinuto: { lte: startMinute },
      fimMinuto: { gte: endMinute },
    },
    select: { id: true },
  });
  return Boolean(range);
}

export async function getReservationAvailability(input: {
  contaId: number;
  serviceConfigId: number;
  resourceId?: number | null;
  dateFrom: string;
  dateTo: string;
  publicOnly?: boolean;
}) {
  const config = await ensureReservationConfig(input.contaId);
  const service = await prisma.reservaServicoConfig.findFirst({
    where: {
      id: input.serviceConfigId,
      contaId: input.contaId,
      ativo: true,
      ...(input.publicOnly ? { publico: true } : {}),
    },
    include: {
      Recursos: {
        where: {
          ...(input.resourceId ? { recursoId: input.resourceId } : {}),
          Recurso: {
            contaId: input.contaId,
            ativo: true,
            ...(input.publicOnly ? { publico: true } : {}),
          },
        },
        include: {
          Recurso: { include: { Disponibilidades: true, Excecoes: true } },
        },
      },
    },
  });
  if (!service) throw new Error("Serviço de reserva não encontrado.");
  const now = new Date();
  const minimum = new Date(now.getTime() + config.antecedenciaMinimaMinutos * 60000);
  const horizon = new Date(now.getTime() + config.horizonteDias * 86400000);
  const slots: Array<{
    startAt: string;
    endAt: string;
    resourceId: number;
    resourceName: string;
  }> = [];

  for (const date of dateRange(input.dateFrom, input.dateTo)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const link of service.Recursos) {
      const resource = link.Recurso;
      const dayStart = zonedDate(date, 0, config.timezone);
      const nextDay = zonedDate(date, 1440, config.timezone);
      const availableExceptions = resource.Excecoes.filter(
        (exception) =>
          exception.tipo === "DISPONIVEL" && overlaps(exception.inicio, exception.fim, dayStart, nextDay),
      ).map((exception) => ({
        start: Math.max(0, Math.floor((exception.inicio.getTime() - dayStart.getTime()) / 60000)),
        end: Math.min(1440, Math.floor((exception.fim.getTime() - dayStart.getTime()) / 60000)),
      }));
      const ranges = [
        ...resource.Disponibilidades.filter(
          (availability) => availability.ativo && availability.diaSemana === weekday,
        ).map((availability) => ({
          start: availability.inicioMinuto,
          end: availability.fimMinuto,
        })),
        ...availableExceptions,
      ];
      const blocks = resource.Excecoes.filter(
        (exception) =>
          exception.tipo === "BLOQUEADO" && overlaps(exception.inicio, exception.fim, dayStart, nextDay),
      );
      for (const range of ranges) {
        for (
          let minute = range.start;
          minute + service.duracaoMinutos <= range.end;
          minute += 30
        ) {
          const startAt = zonedDate(date, minute, config.timezone);
          const endAt = new Date(startAt.getTime() + service.duracaoMinutos * 60000);
          if (startAt < minimum || startAt > horizon) continue;
          if (blocks.some((block) => overlaps(startAt, endAt, block.inicio, block.fim))) continue;
          if (
            await resourceIsFree(
              prisma,
              input.contaId,
              resource.id,
              startAt,
              endAt,
              service.intervaloAntesMinutos,
              service.intervaloDepoisMinutos,
            )
          ) {
            slots.push({
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
              resourceId: resource.id,
              resourceName: resource.nome,
            });
          }
        }
      }
    }
  }
  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.resourceId - b.resourceId);
}

export async function getPublicReservationStore(slug: string) {
  const config = await prisma.reservaConfig.findFirst({
    where: { slug, ativo: true },
    include: {
      Conta: {
        select: {
          nome: true,
          nomeFantasia: true,
          profile: true,
          telefone: true,
          email: true,
        },
      },
    },
  });
  if (!config) throw new Error("Página de reservas não encontrada.");
  if (!(await contaHasActiveModule(config.contaId, "reservas"))) {
    throw new Error("O módulo Reservas não está ativo.");
  }
  return {
    identity: {
      name: config.Conta.nomeFantasia || config.Conta.nome,
      logo: config.Conta.profile,
      phone: config.Conta.telefone,
      email: config.Conta.email,
    },
    slug: config.slug,
    timezone: config.timezone,
    title: config.titulo,
    description: config.descricao,
    bannerUrl: config.bannerUrl,
    colors: { primary: config.corPrimaria, secondary: config.corSecundaria },
    terms: { text: config.termos, version: config.termosVersao },
    theme: config.themeConfig || {},
    sections: config.secoes || [],
    bookingWindow: {
      minimumNoticeMinutes: config.antecedenciaMinimaMinutos,
      horizonDays: config.horizonteDias,
    },
  };
}

export async function getPublicReservationTenant(slug: string) {
  const config = await prisma.reservaConfig.findFirst({
    where: { slug, ativo: true },
    select: { contaId: true },
  });
  if (!config) throw new Error("Página de reservas não encontrada.");
  if (!(await contaHasActiveModule(config.contaId, "reservas"))) {
    throw new Error("O módulo Reservas não está ativo.");
  }
  return config;
}

async function findSafeCustomerLink(
  db: Db,
  contaId: number,
  customer: ReservationCustomerInput,
) {
  const phone = normalizeReservationPhone(customer.phone);
  const suffix = phone.slice(-8);
  const candidates = await db.clientesFornecedores.findMany({
    where: {
      contaId,
      OR: [
        ...(customer.email ? [{ email: customer.email.trim().toLowerCase() }] : []),
        { telefone: { contains: suffix } },
        { whastapp: { contains: suffix } },
      ],
    },
    select: { id: true, email: true, telefone: true, whastapp: true },
    take: 20,
  });
  const exact = candidates.filter(
    (candidate) =>
      (customer.email &&
        candidate.email?.trim().toLowerCase() === customer.email.trim().toLowerCase()) ||
      normalizeReservationPhone(candidate.whastapp || candidate.telefone) === phone,
  );
  return exact.length === 1 ? exact[0].id : null;
}

async function lockResourceDay(
  tx: Prisma.TransactionClient,
  contaId: number,
  resourceId: number,
  startAt: Date,
) {
  const config = await tx.reservaConfig.findUniqueOrThrow({ where: { contaId } });
  const parts = dateParts(startAt, config.timezone);
  const dataLocal = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  const lock = await tx.reservaAgendaLock.upsert({
    where: { contaId_recursoId_dataLocal: { contaId, recursoId: resourceId, dataLocal } },
    create: { contaId, recursoId: resourceId, dataLocal },
    update: { updatedAt: new Date() },
  });
  await tx.reservaAgendaLock.update({ where: { id: lock.id }, data: { updatedAt: new Date() } });
}

async function createBookingRecord(
  contaId: number,
  input: ReservationCreateInput,
  idempotencyKey: string,
) {
  const token = managementToken(contaId, idempotencyKey);
  const config = await ensureReservationConfig(contaId);
  const result = await prisma.$transaction(
    async (tx) => {
      const replay = await tx.reservaGeral.findUnique({
        where: { contaId_idempotencyKey: { contaId, idempotencyKey } },
        include: BOOKING_INCLUDE,
      });
      if (replay) return { booking: replay, replayed: true, token };

      const service = await tx.reservaServicoConfig.findFirst({
        where: { id: input.serviceConfigId, contaId, ativo: true },
        include: {
          Servico: true,
          Recursos: { include: { Recurso: true } },
        },
      });
      if (!service) throw new Error("Serviço de reserva não encontrado.");
      if (input.startAt < new Date(Date.now() + config.antecedenciaMinimaMinutos * 60000)) {
        throw new Error("O horário não respeita a antecedência mínima.");
      }
      if (input.startAt > new Date(Date.now() + config.horizonteDias * 86400000)) {
        throw new Error("O horário está além do horizonte permitido.");
      }
      if (!input.acceptedTerms) throw new Error("É necessário aceitar os termos da reserva.");

      const candidateResources = service.Recursos.map((item) => item.Recurso)
        .filter((resource) => resource.contaId === contaId && resource.ativo)
        .filter((resource) => !input.resourceId || resource.id === input.resourceId)
        .sort((a, b) => a.id - b.id);
      if (!candidateResources.length) throw new Error("Nenhum recurso compatível foi encontrado.");
      if (!input.resourceId && !service.permitirQualquerRecurso) {
        throw new Error("Escolha um recurso para este serviço.");
      }

      const endAt = new Date(input.startAt.getTime() + service.duracaoMinutos * 60000);
      let selected = null as (typeof candidateResources)[number] | null;
      for (const resource of candidateResources) {
        await lockResourceDay(tx, contaId, resource.id, input.startAt);
        if (
          await resourceAllowsTime(
            tx,
            contaId,
            resource.id,
            input.startAt,
            endAt,
            config.timezone,
          ) &&
          await resourceIsFree(
            tx,
            contaId,
            resource.id,
            input.startAt,
            endAt,
            service.intervaloAntesMinutos,
            service.intervaloDepoisMinutos,
          )
        ) {
          selected = resource;
          break;
        }
      }
      if (!selected) throw new Error("O horário acabou de ser reservado. Escolha outro.");

      const paymentValue = calculateReservationPayment({
        total: service.Servico.preco,
        policy: service.politicaPagamento,
        fixedDeposit: service.valorSinal,
        percentageDeposit: service.percentualSinal,
      });
      const requiresPayment = paymentValue.gt(0);
      const customerId = await findSafeCustomerLink(tx, contaId, input.customer);
      const booking = await tx.reservaGeral.create({
        data: {
          contaId,
          publicId: randomUUID(),
          idempotencyKey,
          tokenGestaoHash: hashToken(token),
          servicoConfigId: service.id,
          recursoId: selected.id,
          clienteId: customerId,
          nomeCliente: input.customer.name.trim(),
          telefoneCliente: normalizeReservationPhone(input.customer.phone),
          emailCliente: input.customer.email?.trim().toLowerCase() || null,
          servicoNome: service.Servico.nome,
          recursoNome: selected.nome,
          inicio: input.startAt,
          fim: endAt,
          valorTotal: service.Servico.preco,
          valorPagamento: paymentValue,
          politicaPagamento: service.politicaPagamento,
          status: requiresPayment
            ? ReservaStatus.AGUARDANDO_PAGAMENTO
            : ReservaStatus.CONFIRMADA,
          expiraEm: requiresPayment
            ? new Date(Date.now() + config.expiracaoPagamentoMinutos * 60000)
            : null,
          confirmadaEm: requiresPayment ? null : new Date(),
          termosVersao: config.termosVersao,
          aceitouTermos: input.acceptedTerms,
          consentiuAvisos: input.operationalConsent || false,
          consentiuPosVenda: input.afterSalesConsent || false,
          observacoes: input.notes,
        },
        include: BOOKING_INCLUDE,
      });
      await tx.reservaHistorico.create({
        data: {
          contaId,
          reservaId: booking.id,
          evento: "CRIADA",
          dados: {
            origem: idempotencyKey.startsWith("internal-") ? "INTERNA" : "PUBLICA",
            inicio: booking.inicio,
            recursoId: booking.recursoId,
          },
        },
      });
      return { booking, replayed: false, token };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
  );
  return result;
}

async function createMercadoPagoCharge(
  booking: Awaited<ReturnType<typeof createBookingRecord>>["booking"],
  idempotencyKey: string,
) {
  const config = await prisma.reservaConfig.findUniqueOrThrow({
    where: { contaId: booking.contaId },
  });
  const existing = await prisma.reservaPagamento.findUnique({
    where: { contaId_idempotencyKey: { contaId: booking.contaId, idempotencyKey } },
  });
  if (existing) return existing;

  const uid = gerarIdUnicoComMetaFinal("COB");
  const reference = {
    contaId: booking.contaId,
    chargeUid: uid,
    kind: "pix" as const,
    origin: { type: "reserva-geral" as const, id: booking.id },
  };
  const mp = await getTenantMercadoPagoService(booking.contaId);
  const payment = await mp.payment.create({
    requestOptions: { idempotencyKey },
    body: {
      payer: {
        email: booking.emailCliente || "cliente@reservas.gestaofacil.app",
        entity_type: "individual",
      },
      external_reference: buildMercadoPagoChargeReference(reference),
      transaction_amount: Number(booking.valorPagamento),
      description: `Reserva ${booking.servicoNome} - ${booking.nomeCliente}`.slice(0, 120),
      payment_method_id: "pix",
      installments: 1,
      callback_url: publicManagementUrl(config.slug, booking.publicId),
      notification_url: buildMercadoPagoOperationalWebhookUrl(env.BASE_URL, reference),
    },
  });
  const gatewayId = payment.id?.toString();
  const link = payment.point_of_interaction?.transaction_data?.ticket_url || null;
  const pix = payment.point_of_interaction?.transaction_data?.qr_code || null;
  if (!gatewayId || (!link && !pix)) throw new Error("O Mercado Pago não retornou o Pix da reserva.");

  return prisma.$transaction(async (tx) => {
    const charge = await tx.cobrancasFinanceiras.create({
      data: {
        contaId: booking.contaId,
        reservaGeralId: booking.id,
        Uid: uid,
        idCobranca: gatewayId,
        gateway: "mercadopago",
        valor: booking.valorPagamento,
        dataVencimento: booking.expiraEm || new Date(),
        externalLink: link,
        pixCopiaCola: pix,
        status: "PENDENTE",
        observacao: `Reserva ${booking.publicId}`,
      },
    });
    return tx.reservaPagamento.create({
      data: {
        contaId: booking.contaId,
        reservaId: booking.id,
        cobrancaId: charge.id,
        gateway: "MERCADOPAGO",
        gatewayReferencia: gatewayId,
        idempotencyKey,
        valor: booking.valorPagamento,
        status: "PENDENTE",
        linkPagamento: link,
        pixCopiaCola: pix,
      },
    });
  });
}

async function scheduleBookingNotifications(
  bookingId: number,
  events: ReservaNotificacaoEvento[],
) {
  const booking = await prisma.reservaGeral.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      Conta: { select: { nome: true, nomeFantasia: true } },
      Pagamentos: { orderBy: { createdAt: "desc" } },
    },
  });
  const config = await prisma.reservaConfig.findUniqueOrThrow({
    where: { contaId: booking.contaId },
  });
  const company = booking.Conta.nomeFantasia || booking.Conta.nome;
  const variables = notificationVariables(booking, config, company);
  const definitions: Record<
    ReservaNotificacaoEvento,
    { enabled: boolean; template: string | null; when: Date; consent: boolean }
  > = {
    PENDENTE_PAGAMENTO: {
      enabled: config.whatsappPendenteAtivo,
      template: config.whatsappPendenteTemplate,
      when: new Date(),
      consent: booking.consentiuAvisos,
    },
    CONFIRMADA: {
      enabled: config.whatsappConfirmadaAtivo,
      template: config.whatsappConfirmadaTemplate,
      when: new Date(),
      consent: booking.consentiuAvisos,
    },
    HORARIO_PROXIMO: {
      enabled: config.whatsappLembreteAtivo,
      template: config.whatsappLembreteTemplate,
      when: new Date(booking.inicio.getTime() - config.whatsappLembreteHoras * 3600000),
      consent: booking.consentiuAvisos,
    },
    POS_VENDA: {
      enabled: config.whatsappPosVendaAtivo,
      template: config.whatsappPosVendaTemplate,
      when: new Date(
        (booking.concluidaEm || booking.fim).getTime() + config.whatsappPosVendaHoras * 3600000,
      ),
      consent: booking.consentiuPosVenda,
    },
  };
  for (const event of events) {
    const definition = definitions[event];
    if (!definition.enabled || !definition.template || !definition.consent) continue;
    const message = renderReservationTemplate(definition.template, variables);
    await prisma.reservaNotificacao.upsert({
      where: {
        reservaId_evento_agendadaPara_versaoReserva: {
          reservaId: booking.id,
          evento: event,
          agendadaPara: definition.when,
          versaoReserva: booking.version,
        },
      },
      create: {
        contaId: booking.contaId,
        reservaId: booking.id,
        evento: event,
        agendadaPara: definition.when,
        template: definition.template,
        mensagem: message,
        versaoReserva: booking.version,
      },
      update: { status: "AGENDADA", mensagem: message, erro: null },
    });
  }
}

export async function createPublicReservation(
  slug: string,
  input: ReservationCreateInput,
  idempotencyKey: string,
) {
  if (!idempotencyKey || idempotencyKey.length < 12 || idempotencyKey.length > 80) {
    throw new Error("Envie uma Idempotency-Key válida.");
  }
  const tenant = await getPublicReservationTenant(slug);
  const config = await prisma.reservaConfig.findUniqueOrThrow({ where: { contaId: tenant.contaId } });
  const created = await createBookingRecord(config.contaId, input, idempotencyKey);
  if (created.replayed) {
    return bookingPublicResult(created.booking, created.token, true);
  }
  if (created.booking.status === ReservaStatus.AGUARDANDO_PAGAMENTO) {
    try {
      await createMercadoPagoCharge(created.booking, `reserva-${config.contaId}-${idempotencyKey}`);
    } catch (error) {
      await prisma.reservaGeral.updateMany({
        where: {
          id: created.booking.id,
          contaId: config.contaId,
          status: ReservaStatus.AGUARDANDO_PAGAMENTO,
        },
        data: { status: ReservaStatus.EXPIRADA, expiraEm: new Date() },
      });
      throw error;
    }
    await scheduleBookingNotifications(created.booking.id, ["PENDENTE_PAGAMENTO"]).catch(
      (error) => console.error("[reservas] Falha ao programar aviso de pagamento", error),
    );
  } else {
    await scheduleBookingNotifications(created.booking.id, ["CONFIRMADA", "HORARIO_PROXIMO"]).catch(
      (error) => console.error("[reservas] Falha ao programar avisos de confirmação", error),
    );
  }
  const booking = await prisma.reservaGeral.findUniqueOrThrow({
    where: { id: created.booking.id },
    include: BOOKING_INCLUDE,
  });
  return bookingPublicResult(booking, created.token, false);
}

function bookingPublicResult(
  booking: any,
  token?: string,
  replayed = false,
) {
  return {
    replayed,
    booking: {
      publicId: booking.publicId,
      status: booking.status,
      service: booking.servicoNome,
      resource: booking.recursoNome,
      startAt: booking.inicio,
      endAt: booking.fim,
      total: Number(booking.valorTotal),
      paymentAmount: Number(booking.valorPagamento),
      paidAmount: Number(booking.valorPago),
      expiresAt: booking.expiraEm,
      version: booking.version,
    },
    payment: booking.Pagamentos?.[0]
      ? {
          status: booking.Pagamentos[0].status,
          link: booking.Pagamentos[0].linkPagamento,
          pixCopyPaste: booking.Pagamentos[0].pixCopiaCola,
        }
      : null,
    managementToken: token,
  };
}

async function authenticatedPublicBooking(slug: string, publicId: string, token: string) {
  const tenant = await getPublicReservationTenant(slug);
  const config = await prisma.reservaConfig.findUnique({ where: { contaId: tenant.contaId } });
  if (!config || !token) throw new Error("Reserva não encontrada.");
  const booking = await prisma.reservaGeral.findFirst({
    where: { publicId, contaId: config.contaId },
    include: BOOKING_INCLUDE,
  });
  if (!booking || booking.tokenGestaoHash !== hashToken(token)) {
    throw new Error("Token da reserva inválido.");
  }
  return { config, booking };
}

export async function getPublicReservation(slug: string, publicId: string, token: string) {
  const { booking } = await authenticatedPublicBooking(slug, publicId, token);
  return bookingPublicResult(booking);
}

export async function reschedulePublicReservation(
  slug: string,
  publicId: string,
  token: string,
  input: { startAt: Date; resourceId?: number | null; version: number },
) {
  const { config, booking } = await authenticatedPublicBooking(slug, publicId, token);
  if (!canChangePublicReservation(booking.inicio, config.antecedenciaRemarcacaoHoras)) {
    throw new Error("O prazo para remarcação online foi encerrado.");
  }
  if (
    booking.status !== ReservaStatus.AGUARDANDO_PAGAMENTO &&
    booking.status !== ReservaStatus.CONFIRMADA
  ) {
    throw new Error("Esta reserva não pode ser remarcada.");
  }
  await rescheduleReservation(booking.contaId, booking.id, input);
  return getPublicReservation(slug, publicId, token);
}

export async function rescheduleReservation(
  contaId: number,
  bookingId: number,
  input: { startAt: Date; resourceId?: number | null; version: number },
) {
  const result = await prisma.$transaction(async (tx) => {
    const config = await tx.reservaConfig.findUniqueOrThrow({ where: { contaId } });
    const booking = await tx.reservaGeral.findFirst({
      where: { id: bookingId, contaId },
      include: { ServicoConfig: true },
    });
    if (!booking) throw new Error("Reserva não encontrada.");
    if (!ACTIVE_STATUSES.includes(booking.status)) throw new Error("Esta reserva não pode ser remarcada.");
    if (booking.version !== input.version) {
      throw new Error("A reserva foi alterada em outra sessão. Atualize a página.");
    }
    if (input.startAt < new Date(Date.now() + config.antecedenciaMinimaMinutos * 60000)) {
      throw new Error("O horário não respeita a antecedência mínima.");
    }
    if (input.startAt > new Date(Date.now() + config.horizonteDias * 86400000)) {
      throw new Error("O horário está além do horizonte permitido.");
    }
    const endAt = new Date(input.startAt.getTime() + booking.ServicoConfig.duracaoMinutos * 60000);
    const resources = await tx.reservaServicoRecurso.findMany({
      where: {
        contaId,
        servicoConfigId: booking.servicoConfigId,
        ...(input.resourceId ? { recursoId: input.resourceId } : {}),
        Recurso: { ativo: true },
      },
      include: { Recurso: true },
      orderBy: { recursoId: "asc" },
    });
    let selected = null as (typeof resources)[number]["Recurso"] | null;
    for (const link of resources) {
      await lockResourceDay(tx, contaId, link.recursoId, input.startAt);
      if (
        await resourceAllowsTime(
          tx,
          contaId,
          link.recursoId,
          input.startAt,
          endAt,
          config.timezone,
        ) &&
        await resourceIsFree(
          tx,
          contaId,
          link.recursoId,
          input.startAt,
          endAt,
          booking.ServicoConfig.intervaloAntesMinutos,
          booking.ServicoConfig.intervaloDepoisMinutos,
          booking.id,
        )
      ) {
        selected = link.Recurso;
        break;
      }
    }
    if (!selected) throw new Error("Nenhum recurso está disponível neste horário.");
    const updated = await tx.reservaGeral.updateMany({
      where: { id: booking.id, contaId, version: input.version },
      data: {
        recursoId: selected.id,
        recursoNome: selected.nome,
        inicio: input.startAt,
        fim: endAt,
        version: { increment: 1 },
      },
    });
    if (!updated.count) throw new Error("A reserva foi alterada em outra sessão. Atualize a página.");
    await tx.reservaNotificacao.updateMany({
      where: {
        contaId,
        reservaId: booking.id,
        status: { in: ["AGENDADA", "PROCESSANDO"] },
        evento: "HORARIO_PROXIMO",
      },
      data: { status: "CANCELADA" },
    });
    await tx.reservaHistorico.create({
      data: {
        contaId,
        reservaId: booking.id,
        evento: "REMARCADA",
        dados: { inicioAnterior: booking.inicio, inicioNovo: input.startAt, recursoId: selected.id },
      },
    });
    return booking.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
  await scheduleBookingNotifications(result, ["HORARIO_PROXIMO"]);
  return prisma.reservaGeral.findFirstOrThrow({ where: { id: result, contaId }, include: BOOKING_INCLUDE });
}

export async function cancelPublicReservation(
  slug: string,
  publicId: string,
  token: string,
  version: number,
) {
  const { config, booking } = await authenticatedPublicBooking(slug, publicId, token);
  if (!canChangePublicReservation(booking.inicio, config.antecedenciaCancelamentoHoras)) {
    throw new Error("O prazo para cancelamento online foi encerrado.");
  }
  assertReservationTransition(booking.status, ReservaStatus.CANCELADA);
  const updated = await prisma.reservaGeral.updateMany({
    where: { id: booking.id, contaId: booking.contaId, version },
    data: {
      status: "CANCELADA",
      canceladaEm: new Date(),
      motivoCancelamento: Number(booking.valorPago) > 0 ? "Cancelada online; estorno pendente" : "Cancelada online",
      version: { increment: 1 },
    },
  });
  if (!updated.count) throw new Error("A reserva foi alterada em outra sessão. Atualize a página.");
  await prisma.reservaNotificacao.updateMany({
    where: { reservaId: booking.id, status: { in: ["AGENDADA", "PROCESSANDO"] } },
    data: { status: "CANCELADA" },
  });
  await prisma.reservaHistorico.create({
    data: { contaId: booking.contaId, reservaId: booking.id, evento: "CANCELADA_PUBLICO" },
  });
  return getPublicReservation(slug, publicId, token);
}

export async function retryPublicReservationPayment(
  slug: string,
  publicId: string,
  token: string,
  idempotencyKey: string,
) {
  const { booking } = await authenticatedPublicBooking(slug, publicId, token);
  if (booking.status !== ReservaStatus.AGUARDANDO_PAGAMENTO) {
    throw new Error("Esta reserva não está aguardando pagamento.");
  }
  const payment = await createMercadoPagoCharge(booking, idempotencyKey);
  return {
    status: payment.status,
    link: payment.linkPagamento,
    pixCopyPaste: payment.pixCopiaCola,
  };
}

export async function getReservationsDashboard(contaId: number, startAt: Date, endAt: Date) {
  const now = new Date();
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [bookings, upcoming, config, activeResources, activeServices] = await Promise.all([
    prisma.reservaGeral.findMany({
      where: { contaId, inicio: { gte: startAt, lte: endAt } },
      select: {
        id: true,
        status: true,
        inicio: true,
        valorTotal: true,
        valorPagamento: true,
        valorPago: true,
        servicoNome: true,
        recursoNome: true,
      },
      orderBy: { inicio: "asc" },
    }),
    prisma.reservaGeral.findMany({
      where: {
        contaId,
        inicio: { gte: now, lte: nextDay },
        status: { in: ACTIVE_STATUSES },
      },
      select: {
        id: true,
        nomeCliente: true,
        servicoNome: true,
        recursoNome: true,
        inicio: true,
        fim: true,
        status: true,
        valorTotal: true,
        valorPago: true,
      },
      orderBy: { inicio: "asc" },
      take: 8,
    }),
    prisma.reservaConfig.findUnique({
      where: { contaId },
      select: { ativo: true, slug: true, timezone: true },
    }),
    prisma.reservaRecurso.count({ where: { contaId, ativo: true } }),
    prisma.reservaServicoConfig.count({ where: { contaId, ativo: true } }),
  ]);

  const timezone = config?.timezone || "America/Sao_Paulo";
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const statusOrder = [
    ReservaStatus.AGUARDANDO_PAGAMENTO,
    ReservaStatus.CONFIRMADA,
    ReservaStatus.CONCLUIDA,
    ReservaStatus.CANCELADA,
    ReservaStatus.EXPIRADA,
  ];
  const statusTotals = new Map(statusOrder.map((status) => [status, 0]));
  const daily = new Map<string, { reservas: number; receita: number }>();
  const services = new Map<string, { reservas: number; receita: number }>();
  const resources = new Map<string, { reservas: number; receita: number }>();

  let receita = 0;
  let valorPendente = 0;
  let aguardandoPagamento = 0;
  let validBookings = 0;

  for (const booking of bookings) {
    const paid = Number(booking.valorPago || 0);
    receita += paid;
    statusTotals.set(booking.status, (statusTotals.get(booking.status) || 0) + 1);

    const key = dayKey.format(booking.inicio);
    const day = daily.get(key) || { reservas: 0, receita: 0 };
    day.reservas += 1;
    day.receita += paid;
    daily.set(key, day);

    const service = services.get(booking.servicoNome) || { reservas: 0, receita: 0 };
    service.reservas += 1;
    service.receita += paid;
    services.set(booking.servicoNome, service);

    const resource = resources.get(booking.recursoNome) || { reservas: 0, receita: 0 };
    resource.reservas += 1;
    resource.receita += paid;
    resources.set(booking.recursoNome, resource);

    if (booking.status === ReservaStatus.AGUARDANDO_PAGAMENTO) {
      aguardandoPagamento += 1;
      valorPendente += Math.max(0, Number(booking.valorPagamento || 0) - paid);
    }
    if (![ReservaStatus.CANCELADA, ReservaStatus.EXPIRADA].includes(booking.status)) {
      validBookings += 1;
    }
  }

  const completedOrConfirmed =
    (statusTotals.get(ReservaStatus.CONFIRMADA) || 0) +
    (statusTotals.get(ReservaStatus.CONCLUIDA) || 0);
  const ranking = (source: Map<string, { reservas: number; receita: number }>) =>
    [...source.entries()]
      .map(([nome, values]) => ({ nome, ...values }))
      .sort((a, b) => b.reservas - a.reservas || b.receita - a.receita)
      .slice(0, 5);

  return {
    periodo: { inicio: startAt, fim: endAt },
    kpis: {
      totalReservas: bookings.length,
      reservasValidas: validBookings,
      taxaConfirmacao: bookings.length ? (completedOrConfirmed / bookings.length) * 100 : 0,
      receita,
      ticketMedio: completedOrConfirmed ? receita / completedOrConfirmed : 0,
    },
    agora: {
      proximas24h: upcoming.length,
      aguardandoPagamento,
      valorPendente,
    },
    serie: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, values]) => ({ data, ...values })),
    distribuicaoStatus: statusOrder.map((status) => ({
      status,
      total: statusTotals.get(status) || 0,
    })),
    topServicos: ranking(services),
    topRecursos: ranking(resources),
    proximas: upcoming,
    configuracao: {
      paginaAtiva: Boolean(config?.ativo),
      slug: config?.slug || null,
      recursosAtivos: activeResources,
      servicosAtivos: activeServices,
    },
  };
}

export async function listReservations(
  contaId: number,
  query: {
    search?: string;
    status?: ReservaStatus;
    serviceConfigId?: number;
    resourceId?: number;
    startAt?: Date;
    endAt?: Date;
    page?: number;
    limit?: number;
  },
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const where: Prisma.ReservaGeralWhereInput = {
    contaId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.serviceConfigId ? { servicoConfigId: query.serviceConfigId } : {}),
    ...(query.resourceId ? { recursoId: query.resourceId } : {}),
    ...(query.startAt || query.endAt
      ? {
          inicio: {
            ...(query.startAt ? { gte: query.startAt } : {}),
            ...(query.endAt ? { lte: query.endAt } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { nomeCliente: { contains: query.search } },
            { telefoneCliente: { contains: query.search } },
            { servicoNome: { contains: query.search } },
            { recursoNome: { contains: query.search } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.reservaGeral.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { inicio: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reservaGeral.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    data: items,
    items,
    page,
    limit,
    total,
    totalPages,
    pagination: { page, limit, total, totalPages },
  };
}

export async function createInternalReservation(
  contaId: number,
  input: ReservationCreateInput & { clientId?: number | null },
) {
  const idempotencyKey = `internal-${randomUUID()}`;
  const created = await createBookingRecord(contaId, input, idempotencyKey);
  if (input.clientId) {
    const client = await prisma.clientesFornecedores.findFirst({
      where: { id: input.clientId, contaId },
      select: { id: true },
    });
    if (!client) throw new Error("Cliente não encontrado.");
    await prisma.reservaGeral.update({
      where: { id: created.booking.id },
      data: { clienteId: client.id },
    });
  }
  return prisma.reservaGeral.findUniqueOrThrow({
    where: { id: created.booking.id },
    include: BOOKING_INCLUDE,
  });
}

export async function linkReservationCustomer(contaId: number, bookingId: number, clientId: number) {
  const client = await prisma.clientesFornecedores.findFirst({
    where: { id: clientId, contaId },
    select: { id: true, nome: true, telefone: true, whastapp: true, email: true },
  });
  const booking = await prisma.reservaGeral.findFirst({
    where: { id: bookingId, contaId },
    select: { id: true },
  });
  if (!client || !booking) throw new Error("Reserva ou cliente não encontrado.");
  const updated = await prisma.reservaGeral.update({
    where: { id: booking.id },
    data: {
      clienteId: client.id,
      nomeCliente: client.nome,
      telefoneCliente: normalizeReservationPhone(client.whastapp || client.telefone),
      emailCliente: client.email,
      version: { increment: 1 },
    },
    include: BOOKING_INCLUDE,
  });
  await prisma.reservaHistorico.create({
    data: { contaId, reservaId: booking.id, evento: "CLIENTE_VINCULADO", dados: { clienteId: clientId } },
  });
  return updated;
}

async function createReservationFinancialEntry(
  tx: Prisma.TransactionClient,
  booking: {
    id: number;
    contaId: number;
    publicId: string;
    clienteId: number | null;
    valorTotal: Decimal.Value;
    valorPago: Decimal.Value;
    inicio: Date;
  },
  method: MetodoPagamento,
) {
  const config = await tx.reservaConfig.findUniqueOrThrow({ where: { contaId: booking.contaId } });
  if (!config.lancamentoAutomatico) return null;
  if (!config.categoriaFinanceiraId || !config.contaFinanceiraId) {
    throw new Error("Configure a categoria e a conta financeira das reservas.");
  }
  const existing = await tx.lancamentoFinanceiro.findUnique({
    where: { reservaGeralId: booking.id },
  });
  if (existing) return existing;
  const total = new Decimal(booking.valorTotal);
  const paid = Decimal.min(total, new Decimal(booking.valorPago));
  const balance = total.minus(paid);
  return tx.lancamentoFinanceiro.create({
    data: {
      Uid: gerarIdUnicoComMetaFinal("FIN"),
      contaId: booking.contaId,
      reservaGeralId: booking.id,
      clienteId: booking.clienteId,
      descricao: `Reserva ${booking.publicId}`,
      valorBruto: total,
      valorTotal: total,
      valorEntrada: paid,
      desconto: 0,
      tipo: "RECEITA",
      formaPagamento: method,
      status: balance.lte(0) ? "PAGO" : "PARCIAL",
      origemSistema: "RESERVA",
      dataLancamento: new Date(),
      dataEntrada: paid.gt(0) ? new Date() : null,
      categoriaId: config.categoriaFinanceiraId,
      contasFinanceiroId: config.contaFinanceiraId,
      parcelas: {
        create: balance.gt(0)
          ? {
              Uid: gerarIdUnicoComMetaFinal("PAR"),
              numero: 1,
              valor: balance,
              valorPago: 0,
              vencimento: booking.inicio,
              pago: false,
              contaFinanceira: config.contaFinanceiraId,
            }
          : {
              Uid: gerarIdUnicoComMetaFinal("PAR"),
              numero: 1,
              valor: total,
              valorPago: total,
              vencimento: new Date(),
              pago: true,
              dataPagamento: new Date(),
              formaPagamento: method,
              contaFinanceira: config.contaFinanceiraId,
            },
      },
    },
  });
}

async function createReservationRefundFinancialEntry(
  tx: Prisma.TransactionClient,
  booking: {
    id: number;
    contaId: number;
    publicId: string;
    clienteId: number | null;
  },
  payment: { id: number; valor: Decimal.Value },
  method: MetodoPagamento,
) {
  const config = await tx.reservaConfig.findUnique({ where: { contaId: booking.contaId } });
  if (!config?.lancamentoAutomatico) return;
  if (!config.categoriaFinanceiraId || !config.contaFinanceiraId) {
    throw new Error("Configure a categoria e a conta financeira das reservas.");
  }
  const existing = await tx.lancamentoFinanceiro.findUnique({
    where: { reservaPagamentoEstornoId: payment.id },
  });
  if (existing) return existing;
  return tx.lancamentoFinanceiro.create({
    data: {
      Uid: gerarIdUnicoComMetaFinal("FIN"),
      contaId: booking.contaId,
      reservaPagamentoEstornoId: payment.id,
      clienteId: booking.clienteId,
      descricao: `Estorno da reserva ${booking.publicId}`,
      valorBruto: payment.valor,
      valorTotal: payment.valor,
      valorEntrada: payment.valor,
      desconto: 0,
      tipo: "DESPESA",
      formaPagamento: method,
      status: "PAGO",
      origemSistema: "RESERVA",
      dataLancamento: new Date(),
      dataEntrada: new Date(),
      categoriaId: config.categoriaFinanceiraId,
      contasFinanceiroId: config.contaFinanceiraId,
      parcelas: {
        create: {
          Uid: gerarIdUnicoComMetaFinal("PAR"),
          numero: 1,
          valor: payment.valor,
          valorPago: payment.valor,
          vencimento: new Date(),
          pago: true,
          dataPagamento: new Date(),
          formaPagamento: method,
          contaFinanceira: config.contaFinanceiraId,
        },
      },
    },
  });
}

export async function applyReservationPaymentEvent(input: {
  contaId: number;
  reservationId: number;
  chargeId: number;
  status: "EFETIVADO" | "CANCELADO" | "ESTORNADO" | "PENDENTE";
  method: MetodoPagamento;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.reservaGeral.findFirst({
      where: { id: input.reservationId, contaId: input.contaId },
      include: { Pagamentos: true },
    });
    if (!booking) return null;
    const payment = booking.Pagamentos.find((item) => item.cobrancaId === input.chargeId);
    if (!payment) return null;

    if (input.status === "EFETIVADO") {
      const alreadyApproved = payment.status === ReservaPagamentoStatus.APROVADO;
      if (!alreadyApproved) {
        const nextPaid = Decimal.min(
          new Decimal(booking.valorTotal),
          new Decimal(booking.valorPago).plus(payment.valor),
        );
        await tx.reservaPagamento.update({
          where: { id: payment.id },
          data: { status: "APROVADO", aprovadoEm: new Date(), erro: null },
        });
        await tx.reservaGeral.update({
          where: { id: booking.id },
          data: {
            status: "CONFIRMADA",
            confirmadaEm: booking.confirmadaEm || new Date(),
            faturadaEm: booking.faturadaEm || new Date(),
            valorPago: nextPaid,
            expiraEm: null,
            version: { increment: 1 },
          },
        });
        await createReservationFinancialEntry(
          tx,
          { ...booking, valorPago: nextPaid },
          input.method,
        );
      }
      return { bookingId: booking.id, confirmed: !alreadyApproved };
    }

    if (input.status === "ESTORNADO") {
      await tx.reservaPagamento.update({
        where: { id: payment.id },
        data: { status: "ESTORNADO", estornadoEm: new Date() },
      });
      await tx.reservaGeral.update({
        where: { id: booking.id },
        data: {
          status: booking.status === "CONCLUIDA" ? booking.status : "CANCELADA",
          canceladaEm: booking.canceladaEm || new Date(),
          motivoCancelamento: "Pagamento estornado",
          valorPago: Decimal.max(0, new Decimal(booking.valorPago).minus(payment.valor)),
          version: { increment: 1 },
        },
      });
      await createReservationRefundFinancialEntry(tx, booking, payment, input.method);
      await tx.reservaHistorico.create({
        data: {
          contaId: booking.contaId,
          reservaId: booking.id,
          evento: "PAGAMENTO_ESTORNADO",
          dados: { pagamentoId: payment.id, valor: payment.valor.toString() },
        },
      });
      return { bookingId: booking.id, confirmed: false };
    }

    await tx.reservaPagamento.update({
      where: { id: payment.id },
      data: {
        status: input.status === "CANCELADO" ? "CANCELADO" : "PENDENTE",
      },
    });
    return { bookingId: booking.id, confirmed: false };
  });
  if (result?.confirmed) {
    await scheduleBookingNotifications(result.bookingId, ["CONFIRMADA", "HORARIO_PROXIMO"]);
  }
  return result;
}

export async function requestReservationRefund(
  contaId: number,
  bookingId: number,
  idempotencyKey: string,
) {
  if (!idempotencyKey || idempotencyKey.length < 12 || idempotencyKey.length > 80) {
    throw new Error("Envie uma Idempotency-Key válida.");
  }
  const booking = await prisma.reservaGeral.findFirst({
    where: { id: bookingId, contaId },
    include: {
      Pagamentos: { orderBy: { aprovadoEm: "desc" } },
      Cobrancas: true,
    },
  });
  if (!booking) throw new Error("Reserva não encontrada.");
  const payment = booking.Pagamentos.find(
    (item) =>
      item.status === ReservaPagamentoStatus.APROVADO ||
      item.status === ReservaPagamentoStatus.ESTORNADO,
  );
  if (!payment) throw new Error("Nenhum pagamento aprovado foi encontrado.");
  if (payment.status === ReservaPagamentoStatus.ESTORNADO) {
    return { status: "ESTORNADO", replayed: true };
  }

  if (payment.gateway === "MERCADOPAGO") {
    if (!payment.gatewayReferencia) throw new Error("Pagamento sem referência do Mercado Pago.");
    const mp = await getTenantMercadoPagoService(contaId);
    const refund = await mp.refund.create({ payment_id: payment.gatewayReferencia });
    if (refund.status !== "approved") {
      await prisma.reservaPagamento.update({
        where: { id: payment.id },
        data: { erro: `Estorno pendente: ${refund.status || "desconhecido"}` },
      });
      return { status: refund.status || "PENDENTE", replayed: false };
    }
    if (payment.cobrancaId) {
      await prisma.cobrancasFinanceiras.updateMany({
        where: { id: payment.cobrancaId, contaId },
        data: { status: "ESTORNADO" },
      });
    }
  }

  await applyReservationPaymentEvent({
    contaId,
    reservationId: booking.id,
    chargeId: payment.cobrancaId || 0,
    status: "ESTORNADO",
    method: "PIX",
  });
  if (!payment.cobrancaId) {
    await prisma.$transaction(async (tx) => {
      await tx.reservaPagamento.update({
        where: { id: payment.id },
        data: { status: "ESTORNADO", estornadoEm: new Date(), erro: null },
      });
      await tx.reservaGeral.update({
        where: { id: booking.id },
        data: {
          status: booking.status === "CONCLUIDA" ? booking.status : "CANCELADA",
          canceladaEm: booking.canceladaEm || new Date(),
          motivoCancelamento: "Pagamento estornado",
          valorPago: Decimal.max(0, new Decimal(booking.valorPago).minus(payment.valor)),
          version: { increment: 1 },
        },
      });
      await createReservationRefundFinancialEntry(tx, booking, payment, "PIX");
      await tx.reservaHistorico.create({
        data: { contaId, reservaId: booking.id, evento: "PAGAMENTO_ESTORNADO", dados: { pagamentoId: payment.id } },
      });
    });
  }
  return { status: "ESTORNADO", replayed: false };
}

export async function recordManualReservationPayment(input: {
  contaId: number;
  reservationId: number;
  amount: number;
  method: MetodoPagamento;
  idempotencyKey: string;
}) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 12 || input.idempotencyKey.length > 80) {
    throw new Error("Envie uma Idempotency-Key válida.");
  }
  if (input.amount <= 0) throw new Error("Informe um valor de pagamento válido.");
  const existing = await prisma.reservaPagamento.findUnique({
    where: {
      contaId_idempotencyKey: {
        contaId: input.contaId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return existing;
  const booking = await prisma.reservaGeral.findFirst({
    where: { id: input.reservationId, contaId: input.contaId },
  });
  if (!booking) throw new Error("Reserva não encontrada.");
  const payment = await prisma.reservaPagamento.create({
    data: {
      contaId: input.contaId,
      reservaId: booking.id,
      gateway: "MANUAL",
      idempotencyKey: input.idempotencyKey,
      valor: input.amount,
      status: "APROVADO",
      aprovadoEm: new Date(),
    },
  });
  await prisma.reservaGeral.update({
    where: { id: booking.id },
    data: {
      status: "CONFIRMADA",
      confirmadaEm: booking.confirmadaEm || new Date(),
      faturadaEm: booking.faturadaEm || new Date(),
      expiraEm: null,
      valorPago: Decimal.min(
        new Decimal(booking.valorTotal),
        new Decimal(booking.valorPago).plus(input.amount),
      ),
      version: { increment: 1 },
    },
  });
  await prisma.$transaction(async (tx) => {
    const refreshed = await tx.reservaGeral.findUniqueOrThrow({ where: { id: booking.id } });
    await createReservationFinancialEntry(tx, refreshed, input.method);
    await tx.reservaHistorico.create({
      data: {
        contaId: input.contaId,
        reservaId: booking.id,
        evento: "PAGAMENTO_MANUAL",
        dados: { pagamentoId: payment.id, valor: input.amount, metodo: input.method },
      },
    });
  });
  await scheduleBookingNotifications(booking.id, ["CONFIRMADA", "HORARIO_PROXIMO"]);
  return payment;
}

export async function actOnReservation(
  contaId: number,
  bookingId: number,
  action: "confirm" | "complete" | "cancel",
  reason?: string,
) {
  const booking = await prisma.reservaGeral.findFirst({ where: { id: bookingId, contaId } });
  if (!booking) throw new Error("Reserva não encontrada.");
  const next =
    action === "confirm"
      ? ReservaStatus.CONFIRMADA
      : action === "complete"
        ? ReservaStatus.CONCLUIDA
        : ReservaStatus.CANCELADA;
  assertReservationTransition(booking.status, next);
  const updated = await prisma.reservaGeral.update({
    where: { id: booking.id },
    data: {
      status: next,
      confirmadaEm: next === "CONFIRMADA" ? new Date() : booking.confirmadaEm,
      concluidaEm: next === "CONCLUIDA" ? new Date() : null,
      canceladaEm: next === "CANCELADA" ? new Date() : null,
      motivoCancelamento: next === "CANCELADA" ? reason || "Cancelada pela equipe" : null,
      expiraEm: next === "CONFIRMADA" ? null : booking.expiraEm,
      version: { increment: 1 },
    },
    include: BOOKING_INCLUDE,
  });
  await prisma.reservaHistorico.create({
    data: {
      contaId,
      reservaId: booking.id,
      evento: next,
      dados: reason ? { motivo: reason } : undefined,
    },
  });
  if (next === "CONFIRMADA") {
    await scheduleBookingNotifications(booking.id, ["CONFIRMADA", "HORARIO_PROXIMO"]);
  } else if (next === "CONCLUIDA") {
    await scheduleBookingNotifications(booking.id, ["POS_VENDA"]);
  } else {
    await prisma.reservaNotificacao.updateMany({
      where: { reservaId: booking.id, status: { in: ["AGENDADA", "PROCESSANDO"] } },
      data: { status: "CANCELADA" },
    });
  }
  return updated;
}

export async function deleteCanceledReservation(contaId: number, bookingId: number) {
  const booking = await prisma.reservaGeral.findFirst({
    where: { id: bookingId, contaId },
    select: { id: true, status: true },
  });
  if (!booking) throw new Error("Reserva não encontrada.");

  assertCanceledReservationCanBeDeleted(booking.status);

  await prisma.reservaGeral.delete({
    where: { id: booking.id },
  });

  return { id: booking.id };
}

export async function processReservationAutomations(now = new Date()) {
  const expired = await prisma.reservaGeral.findMany({
    where: {
      status: "AGUARDANDO_PAGAMENTO",
      expiraEm: { lte: now },
    },
    select: { id: true, contaId: true },
    take: 200,
  });
  for (const booking of expired) {
    await prisma.reservaGeral.updateMany({
      where: { id: booking.id, contaId: booking.contaId, status: "AGUARDANDO_PAGAMENTO" },
      data: { status: "EXPIRADA", version: { increment: 1 } },
    });
    await prisma.reservaNotificacao.updateMany({
      where: { reservaId: booking.id, status: { in: ["AGENDADA", "PROCESSANDO"] } },
      data: { status: "CANCELADA" },
    });
  }

  const notifications = await prisma.reservaNotificacao.findMany({
    where: { status: { in: ["AGENDADA", "FALHOU"] }, agendadaPara: { lte: now }, tentativas: { lt: 3 } },
    include: { Reserva: true },
    orderBy: { agendadaPara: "asc" },
    take: 100,
  });
  let queued = 0;
  for (const notification of notifications) {
    if (
      notification.Reserva.status === "CANCELADA" ||
      notification.Reserva.status === "EXPIRADA" ||
      notification.Reserva.version !== notification.versaoReserva
    ) {
      await prisma.reservaNotificacao.update({
        where: { id: notification.id },
        data: { status: "CANCELADA" },
      });
      continue;
    }
    try {
      await enqueueWhatsAppReservationMessage(
        notification.contaId,
        notification.reservaId,
        notification.Reserva.telefoneCliente,
        notification.mensagem,
        notification.id,
      );
      await prisma.reservaNotificacao.update({
        where: { id: notification.id },
        data: {
          status: "PROCESSANDO",
          tentativas: { increment: 1 },
          ultimaTentativaEm: now,
          erro: null,
        },
      });
      queued += 1;
    } catch (error: any) {
      await prisma.reservaNotificacao.update({
        where: { id: notification.id },
        data: {
          status: "FALHOU",
          tentativas: { increment: 1 },
          ultimaTentativaEm: now,
          erro: String(error?.message || error),
        },
      });
    }
  }
  return { expired: expired.length, queued };
}
