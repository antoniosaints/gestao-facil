import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import Decimal from "decimal.js";

import { prisma } from "../../utils/prisma";
import {
  DEFAULT_LEMBRETE_DIAS,
  DEFAULT_LEMBRETE_HORA,
  DEFAULT_MENSAGEM_INADIMPLENCIA,
  normalizeDiasLembrete,
  resolveLembreteSchedule,
  type LembreteConfigInput,
} from "./inadimplenciaLembretePolicy";

export type InadimplenciaStatusFiltro = "TODOS" | "ATRASADOS" | "A_VENCER";

export type InadimplenciaListParams = {
  search?: string;
  status?: InadimplenciaStatusFiltro;
  clienteId?: number | null;
  page?: number;
  pageSize?: number;
};

export type LembreteConfigPayload = {
  ativo: boolean;
  dias: number[];
  canalWhatsapp: boolean;
  canalEmail: boolean;
  canalSms: boolean;
  mensagemCustom?: string | null;
};

const CONFIG_SELECT = {
  ativo: true,
  diasLembrete: true,
  canalWhatsapp: true,
  canalEmail: true,
  canalSms: true,
  mensagemCustom: true,
} as const;

function toConfigInput(row: {
  ativo: boolean;
  diasLembrete: unknown;
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

function num(value: unknown) {
  return new Decimal(value == null ? 0 : (value as Decimal.Value)).toNumber();
}

/** Próxima data de disparo (>= hoje) considerando as parcelas pendentes e a agenda. */
function computeProximoLembrete(
  parcelas: Array<{ vencimento: Date }>,
  dias: number[],
  hoje: Date,
): Date | null {
  let proximo: Date | null = null;
  for (const parcela of parcelas) {
    const base = startOfDay(parcela.vencimento);
    for (const dia of dias) {
      const fire = addDays(base, dia);
      if (fire.getTime() < hoje.getTime()) continue;
      if (!proximo || fire.getTime() < proximo.getTime()) proximo = fire;
    }
  }
  return proximo;
}

function buildListWhere(contaId: number, params: InadimplenciaListParams, hoje: Date) {
  const search = params.search?.trim();

  const parcelasFilter =
    params.status === "ATRASADOS"
      ? { some: { pago: false, vencimento: { lt: hoje } } }
      : params.status === "A_VENCER"
        ? { some: { pago: false }, none: { pago: false, vencimento: { lt: hoje } } }
        : { some: { pago: false } };

  return {
    contaId,
    tipo: "RECEITA" as const,
    clienteId: params.clienteId ? params.clienteId : { not: null },
    parcelas: parcelasFilter,
    ...(search
      ? {
          OR: [
            { descricao: { contains: search } },
            { Uid: { contains: search } },
            { cliente: { nome: { contains: search } } },
          ],
        }
      : {}),
  };
}

function mapLancamentoRow(
  lancamento: any,
  hoje: Date,
  defaultDias: unknown,
) {
  const parcelasPendentes = lancamento.parcelas as Array<{ id: number; numero: number; valor: unknown; vencimento: Date }>;
  const atrasadas = parcelasPendentes.filter((p) => startOfDay(p.vencimento).getTime() < hoje.getTime());

  const valorPendente = parcelasPendentes.reduce((acc, p) => acc.plus(num(p.valor)), new Decimal(0));
  const valorAtrasado = atrasadas.reduce((acc, p) => acc.plus(num(p.valor)), new Decimal(0));

  const proximoVencimento = parcelasPendentes.length
    ? parcelasPendentes.reduce((min, p) => (p.vencimento < min ? p.vencimento : min), parcelasPendentes[0].vencimento)
    : null;

  const primeiraAtrasada = atrasadas.length
    ? atrasadas.reduce((min, p) => (p.vencimento < min ? p.vencimento : min), atrasadas[0].vencimento)
    : null;
  const diasAtraso = primeiraAtrasada
    ? Math.max(0, differenceInCalendarDays(hoje, startOfDay(primeiraAtrasada)))
    : 0;

  const schedule = resolveLembreteSchedule({
    override: toConfigInput(lancamento.lembreteCliente),
    clienteConfig: toConfigInput(lancamento.cliente?.LembreteConfig),
    legacyFlag: lancamento.notificarClienteVencimento,
    defaultDias,
  });

  const proximoLembrete = schedule
    ? computeProximoLembrete(parcelasPendentes, schedule.dias, hoje)
    : null;

  return {
    id: lancamento.id,
    Uid: lancamento.Uid,
    descricao: lancamento.descricao,
    status: lancamento.status,
    cliente: lancamento.cliente
      ? { id: lancamento.cliente.id, nome: lancamento.cliente.nome }
      : null,
    valorPendente: valorPendente.toNumber(),
    valorAtrasado: valorAtrasado.toNumber(),
    parcelasPendentes: parcelasPendentes.length,
    parcelasAtrasadas: atrasadas.length,
    diasAtraso,
    proximoVencimento,
    proximoLembrete,
    lembrete: {
      ativo: Boolean(schedule),
      origem: schedule?.origem ?? null,
      dias: schedule?.dias ?? [],
      canais: schedule?.canais ?? { whatsapp: false, email: false, sms: false },
      mensagemCustom: schedule?.mensagemCustom ?? null,
      temOverride: Boolean(lancamento.lembreteCliente),
      overrideAtivo: lancamento.lembreteCliente ? lancamento.lembreteCliente.ativo : null,
      temConfigCliente: Boolean(lancamento.cliente?.LembreteConfig),
    },
  };
}

export async function listInadimplencia(contaId: number, params: InadimplenciaListParams) {
  const hoje = startOfDay(new Date());
  const page = params.page && params.page > 0 ? params.page : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(params.pageSize, 100) : 10;

  const where = buildListWhere(contaId, params, hoje);

  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: { inadimplenciaDiasPadrao: true },
  });
  const defaultDias = parametros?.inadimplenciaDiasPadrao ?? null;

  const [total, lancamentos] = await Promise.all([
    prisma.lancamentoFinanceiro.count({ where }),
    prisma.lancamentoFinanceiro.findMany({
      where,
      select: {
        id: true,
        Uid: true,
        descricao: true,
        status: true,
        notificarClienteVencimento: true,
        cliente: {
          select: {
            id: true,
            nome: true,
            LembreteConfig: { select: CONFIG_SELECT },
          },
        },
        lembreteCliente: { select: CONFIG_SELECT },
        parcelas: {
          where: { pago: false },
          select: { id: true, numero: true, valor: true, vencimento: true },
          orderBy: { vencimento: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: lancamentos.map((l) => mapLancamentoRow(l, hoje, defaultDias)),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getInadimplenciaConfig(contaId: number) {
  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId },
    select: {
      inadimplenciaHoraEnvio: true,
      inadimplenciaDiasPadrao: true,
      inadimplenciaMensagemPadrao: true,
    },
  });

  const dias = normalizeDiasLembrete(parametros?.inadimplenciaDiasPadrao);

  return {
    horaEnvio: parametros?.inadimplenciaHoraEnvio ?? DEFAULT_LEMBRETE_HORA,
    dias: dias.length ? dias : [...DEFAULT_LEMBRETE_DIAS],
    mensagem: parametros?.inadimplenciaMensagemPadrao ?? null,
    mensagemModelo: parametros?.inadimplenciaMensagemPadrao || DEFAULT_MENSAGEM_INADIMPLENCIA,
  };
}

export async function saveInadimplenciaConfig(
  contaId: number,
  payload: { horaEnvio: number; dias: number[]; mensagem?: string | null },
) {
  const horaEnvio = Number.isInteger(payload.horaEnvio) ? Math.min(Math.max(payload.horaEnvio, 0), 23) : DEFAULT_LEMBRETE_HORA;
  const dias = normalizeDiasLembrete(payload.dias);
  const mensagem = payload.mensagem?.trim() || null;

  const data = {
    inadimplenciaHoraEnvio: horaEnvio,
    inadimplenciaDiasPadrao: dias.length ? dias : [...DEFAULT_LEMBRETE_DIAS],
    inadimplenciaMensagemPadrao: mensagem,
  };

  await prisma.parametrosConta.upsert({
    where: { contaId },
    create: { contaId, ...data },
    update: data,
  });

  return { horaEnvio, dias: data.inadimplenciaDiasPadrao, mensagem };
}

export async function getInadimplenciaResumo(contaId: number) {
  const hoje = startOfDay(new Date());
  const baseLancamento = { contaId, tipo: "RECEITA" as const, clienteId: { not: null } };

  const [aReceber, atrasado, inadimplentes, comOverrideAtivo, comConfigCliente, comLegado] =
    await Promise.all([
      prisma.parcelaFinanceiro.aggregate({
        where: { pago: false, lancamento: baseLancamento },
        _sum: { valor: true },
      }),
      prisma.parcelaFinanceiro.aggregate({
        where: { pago: false, vencimento: { lt: hoje }, lancamento: baseLancamento },
        _sum: { valor: true },
      }),
      prisma.lancamentoFinanceiro.findMany({
        where: { ...baseLancamento, parcelas: { some: { pago: false, vencimento: { lt: hoje } } } },
        select: { clienteId: true },
        distinct: ["clienteId"],
      }),
      // Lembrete ativo resolvido (precedência override → cliente → legado), sem dupla contagem:
      prisma.lancamentoFinanceiro.count({
        where: { ...baseLancamento, parcelas: { some: { pago: false } }, lembreteCliente: { ativo: true } },
      }),
      prisma.lancamentoFinanceiro.count({
        where: {
          ...baseLancamento,
          parcelas: { some: { pago: false } },
          lembreteCliente: { is: null },
          cliente: { LembreteConfig: { ativo: true } },
        },
      }),
      prisma.lancamentoFinanceiro.count({
        where: {
          ...baseLancamento,
          parcelas: { some: { pago: false } },
          lembreteCliente: { is: null },
          cliente: { LembreteConfig: { is: null } },
          notificarClienteVencimento: true,
        },
      }),
    ]);

  return {
    totalAReceber: num(aReceber._sum.valor),
    totalAtrasado: num(atrasado._sum.valor),
    clientesInadimplentes: inadimplentes.length,
    lancamentosComLembrete: comOverrideAtivo + comConfigCliente + comLegado,
  };
}

function normalizePayload(payload: LembreteConfigPayload) {
  return {
    ativo: Boolean(payload.ativo),
    diasLembrete: normalizeDiasLembrete(payload.dias),
    canalWhatsapp: Boolean(payload.canalWhatsapp),
    canalEmail: Boolean(payload.canalEmail),
    canalSms: Boolean(payload.canalSms),
    mensagemCustom: payload.mensagemCustom?.trim() || null,
  };
}

export async function upsertClienteLembreteConfig(
  contaId: number,
  clienteId: number,
  payload: LembreteConfigPayload,
) {
  const cliente = await prisma.clientesFornecedores.findFirst({
    where: { id: clienteId, contaId },
    select: { id: true },
  });
  if (!cliente) throw new Error("Cliente não encontrado.");

  const data = normalizePayload(payload);

  return prisma.clienteLembreteConfig.upsert({
    where: { clienteId },
    create: { contaId, clienteId, ...data },
    update: data,
  });
}

export async function upsertLancamentoLembreteOverride(
  contaId: number,
  lancamentoId: number,
  payload: LembreteConfigPayload,
) {
  const lancamento = await prisma.lancamentoFinanceiro.findFirst({
    where: { id: lancamentoId, contaId },
    select: { id: true, tipo: true, clienteId: true },
  });
  if (!lancamento) throw new Error("Lançamento não encontrado.");
  if (lancamento.tipo !== "RECEITA" || !lancamento.clienteId) {
    throw new Error("Só é possível configurar lembretes em receitas com cliente vinculado.");
  }

  const data = normalizePayload(payload);

  return prisma.lancamentoLembreteCliente.upsert({
    where: { lancamentoId },
    create: { contaId, lancamentoId, ...data },
    update: data,
  });
}

export async function removeLancamentoLembreteOverride(contaId: number, lancamentoId: number) {
  const existing = await prisma.lancamentoLembreteCliente.findFirst({
    where: { lancamentoId, contaId },
    select: { id: true },
  });
  if (!existing) return { removed: false };

  await prisma.lancamentoLembreteCliente.delete({ where: { id: existing.id } });
  return { removed: true };
}

export async function bulkUpsertLancamentoOverrides(
  contaId: number,
  lancamentoIds: number[],
  payload: LembreteConfigPayload,
) {
  const validos = await prisma.lancamentoFinanceiro.findMany({
    where: { id: { in: lancamentoIds }, contaId, tipo: "RECEITA", clienteId: { not: null } },
    select: { id: true },
  });

  const data = normalizePayload(payload);

  await prisma.$transaction(
    validos.map((l) =>
      prisma.lancamentoLembreteCliente.upsert({
        where: { lancamentoId: l.id },
        create: { contaId, lancamentoId: l.id, ...data },
        update: data,
      }),
    ),
  );

  return { atualizados: validos.length };
}
