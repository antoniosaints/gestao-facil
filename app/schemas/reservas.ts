import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const date = z.coerce.date();

export const reservationConfigSchema = z.object({
  slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  ativo: z.boolean().optional(),
  timezone: z.string().trim().min(3).max(80).optional(),
  antecedenciaMinimaMinutos: z.number().int().min(0).max(43200).optional(),
  horizonteDias: z.number().int().min(1).max(365).optional(),
  expiracaoPagamentoMinutos: z.number().int().min(5).max(1440).optional(),
  antecedenciaRemarcacaoHoras: z.number().int().min(0).max(720).optional(),
  antecedenciaCancelamentoHoras: z.number().int().min(0).max(720).optional(),
  titulo: z.string().trim().max(160).nullable().optional(),
  descricao: z.string().trim().max(3000).nullable().optional(),
  bannerUrl: z.string().trim().max(1000).nullable().optional(),
  corPrimaria: color.optional(),
  corSecundaria: color.optional(),
  termos: z.string().trim().max(20000).nullable().optional(),
  themeConfig: z.record(z.unknown()).nullable().optional(),
  secoes: z.array(z.string().trim().max(40)).max(12).optional(),
  lancamentoAutomatico: z.boolean().optional(),
  categoriaFinanceiraId: z.number().int().positive().nullable().optional(),
  contaFinanceiraId: z.number().int().positive().nullable().optional(),
  whatsappPendenteAtivo: z.boolean().optional(),
  whatsappPendenteTemplate: z.string().trim().max(2000).nullable().optional(),
  whatsappConfirmadaAtivo: z.boolean().optional(),
  whatsappConfirmadaTemplate: z.string().trim().max(2000).nullable().optional(),
  whatsappLembreteAtivo: z.boolean().optional(),
  whatsappLembreteHoras: z.number().int().min(1).max(720).optional(),
  whatsappLembreteTemplate: z.string().trim().max(2000).nullable().optional(),
  whatsappPosVendaAtivo: z.boolean().optional(),
  whatsappPosVendaHoras: z.number().int().min(0).max(720).optional(),
  whatsappPosVendaTemplate: z.string().trim().max(2000).nullable().optional(),
});

export const reservationResourceSchema = z.object({
  id: z.number().int().positive().optional(),
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().trim().max(1000).nullable().optional(),
  tipo: z.enum(["PROFISSIONAL", "SALA", "EQUIPAMENTO"]),
  ativo: z.boolean().optional(),
  publico: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});

export const reservationAvailabilitySchema = z.object({
  ranges: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(1).max(1440),
    }),
  ).max(50),
});

export const reservationExceptionSchema = z.object({
  id: z.number().int().positive().optional(),
  resourceId: z.number().int().positive(),
  startAt: date,
  endAt: date,
  type: z.enum(["DISPONIVEL", "BLOQUEADO"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const reservationServiceConfigSchema = z.object({
  serviceId: z.number().int().positive(),
  durationMinutes: z.number().int().min(5).max(1440),
  bufferBeforeMinutes: z.number().int().min(0).max(720).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(720).optional(),
  paymentPolicy: z.enum(["NENHUM", "INTEGRAL", "SINAL_FIXO", "SINAL_PERCENTUAL"]),
  fixedDeposit: z.number().positive().nullable().optional(),
  percentageDeposit: z.number().positive().lt(100).nullable().optional(),
  active: z.boolean().optional(),
  public: z.boolean().optional(),
  allowAnyResource: z.boolean().optional(),
  resourceIds: z.array(z.number().int().positive()).min(1).max(100),
});

const customer = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(30),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
});

export const reservationCreateSchema = z.object({
  serviceConfigId: z.number().int().positive(),
  resourceId: z.number().int().positive().nullable().optional(),
  startAt: date,
  customer,
  acceptedTerms: z.boolean(),
  operationalConsent: z.boolean().optional(),
  afterSalesConsent: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
  clientId: z.number().int().positive().nullable().optional(),
});

export const reservationPreviewSchema = z.object({
  serviceConfigId: z.number().int().positive(),
  resourceId: z.number().int().positive().nullable().optional(),
  startAt: date,
});

export const reservationRescheduleSchema = z.object({
  startAt: date,
  resourceId: z.number().int().positive().nullable().optional(),
  version: z.number().int().positive(),
});

export const reservationCancelSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().trim().max(1000).optional(),
});

export const reservationManualPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["DINHEIRO", "PIX", "CARTAO", "DEBITO", "BOLETO", "GATEWAY", "OUTRO"]),
});

export const reservationLinkCustomerSchema = z.object({
  clientId: z.number().int().positive(),
});
