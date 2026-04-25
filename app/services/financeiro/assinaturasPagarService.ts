import { addDays, addMonths, addWeeks, addYears, format, startOfDay } from 'date-fns'
import type { Prisma, PrismaClient } from '../../../generated/client'
import { criarLancamentoFinanceiro } from './lancamentoService'

type DbClient = Prisma.TransactionClient | PrismaClient

type AssinaturaPagarBase = {
  id: number
  contaId: number
  nomeServico: string
  valor: unknown
  periodicidade: string
  intervaloDiasPersonalizado: number | null
  inicio: Date
  fim: Date | null
  proximoVencimento: Date | null
  status: string
  gerarFinanceiro: boolean
  gerarAutomatico: boolean
  contaFinanceiraId: number | null
  categoriaId: number | null
  formaPagamento: string | null
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function getPeriodStep(periodicidade: string, intervaloDias?: number | null) {
  switch (periodicidade) {
    case 'SEMANAL':
      return { kind: 'weeks' as const, value: 1 }
    case 'QUINZENAL':
      return { kind: 'weeks' as const, value: 2 }
    case 'ANUAL':
      return { kind: 'years' as const, value: 1 }
    case 'PERSONALIZADO':
      return { kind: 'days' as const, value: intervaloDias || 30 }
    case 'MENSAL':
    default:
      return { kind: 'months' as const, value: 1 }
  }
}

export function advanceAssinaturaPagarDate(base: Date, periodicidade: string, intervaloDias?: number | null) {
  const step = getPeriodStep(periodicidade, intervaloDias)
  if (step.kind === 'days') return addDays(base, step.value)
  if (step.kind === 'weeks') return addWeeks(base, step.value)
  if (step.kind === 'years') return addYears(base, step.value)
  return addMonths(base, step.value)
}

export function buildAssinaturaPagarReference(base: Date, periodicidade: string) {
  if (periodicidade === 'SEMANAL' || periodicidade === 'QUINZENAL' || periodicidade === 'PERSONALIZADO') {
    return format(base, 'yyyy-MM-dd')
  }

  return format(base, 'yyyy-MM')
}

function resolveLancamentoDescription(nomeServico: string, reference: string) {
  return `Assinatura • ${nomeServico} • ${reference}`
}

function normalizeFormaPagamento(value?: string | null) {
  switch (value) {
    case 'DINHEIRO':
    case 'DEBITO':
    case 'CREDITO':
    case 'BOLETO':
    case 'TRANSFERENCIA':
    case 'CHEQUE':
    case 'GATEWAY':
    case 'OUTRO':
      return value
    case 'PIX':
    default:
      return 'PIX'
  }
}

function resolveCurrentDueDate(lancamento: {
  dataLancamento: Date
  parcelas: Array<{ numero: number; vencimento: Date }>
}) {
  const parcelaPrincipal = [...lancamento.parcelas]
    .filter((item) => item.numero !== 0)
    .sort((a, b) => a.numero - b.numero)[0]

  return startOfDay(parcelaPrincipal?.vencimento || lancamento.dataLancamento)
}

function resolveNextDueDate(assinatura: AssinaturaPagarBase, currentDueDate: Date) {
  const nextDueDate = startOfDay(
    advanceAssinaturaPagarDate(
      currentDueDate,
      assinatura.periodicidade,
      assinatura.intervaloDiasPersonalizado,
    ),
  )

  if (assinatura.fim && nextDueDate > startOfDay(assinatura.fim)) {
    return null
  }

  return nextDueDate
}

function validateFinancialConfig(assinatura: AssinaturaPagarBase) {
  if (!assinatura.gerarFinanceiro) {
    throw new Error('A assinatura está configurada sem geração financeira.')
  }

  if (!assinatura.contaFinanceiraId) {
    throw new Error('Selecione a conta financeira de saída para gerar o lançamento.')
  }

  if (!assinatura.categoriaId) {
    throw new Error('Selecione a categoria financeira para gerar o lançamento.')
  }

  if (!assinatura.proximoVencimento) {
    throw new Error('Informe a data de vencimento da assinatura.')
  }
}

export async function garantirLancamentoAtualAssinaturaPagar(
  db: DbClient,
  assinaturaId: number,
) {
  const assinatura = await db.assinaturaPagar.findUniqueOrThrow({
    where: { id: assinaturaId },
  })

  validateFinancialConfig(assinatura)

  const dueDate = startOfDay(assinatura.proximoVencimento as Date)
  const reference = buildAssinaturaPagarReference(dueDate, assinatura.periodicidade)

  const existing = await db.lancamentoFinanceiro.findFirst({
    where: {
      assinaturaPagarId: assinatura.id,
      referenciaRecorrencia: reference,
    },
    select: { id: true },
  })

  if (existing) {
    return {
      created: false,
      lancamentoId: existing.id,
      reference,
      dueDate,
    }
  }

  const created = await criarLancamentoFinanceiro(
    db as never,
    assinatura.contaId,
    {
      descricao: resolveLancamentoDescription(assinatura.nomeServico, reference),
      valorTotal: toNumber(assinatura.valor),
      tipo: 'DESPESA',
      formaPagamento: normalizeFormaPagamento(assinatura.formaPagamento),
      status: 'PENDENTE',
      categoriaId: assinatura.categoriaId as number,
      dataLancamento: dueDate,
      parcelas: 1,
      contasFinanceiroId: assinatura.contaFinanceiraId as number,
      tipoLancamentoModo: 'AVISTA',
    },
    { skipNotification: true },
  )

  await db.lancamentoFinanceiro.update({
    where: { id: created.id },
    data: {
      origemSistema: 'ASSINATURA_PAGAR',
      referenciaRecorrencia: reference,
      assinaturaPagarId: assinatura.id,
    },
  })

  return {
    created: true,
    lancamentoId: created.id,
    reference,
    dueDate,
  }
}

export async function processarPosPagamentoAssinaturaPagar(
  db: DbClient,
  lancamentoId: number,
) {
  const lancamento = await db.lancamentoFinanceiro.findUnique({
    where: { id: lancamentoId },
    include: {
      parcelas: {
        orderBy: { numero: 'asc' },
      },
      assinaturaPagar: true,
    },
  })

  if (!lancamento?.assinaturaPagar) {
    return {
      linked: false,
      generated: false,
      nextDueDate: null as Date | null,
      lancamentoId: null as number | null,
    }
  }

  const parcelasValidas = lancamento.parcelas.filter((item) => item.numero !== 0)
  const fullyPaid = parcelasValidas.length > 0 && parcelasValidas.every((item) => item.pago)

  if (!fullyPaid) {
    return {
      linked: true,
      generated: false,
      nextDueDate: lancamento.assinaturaPagar.proximoVencimento,
      lancamentoId: null as number | null,
    }
  }

  const currentDueDate = resolveCurrentDueDate(lancamento)
  const nextDueDate = resolveNextDueDate(lancamento.assinaturaPagar, currentDueDate)

  await db.assinaturaPagar.update({
    where: { id: lancamento.assinaturaPagar.id },
    data: {
      proximoVencimento: nextDueDate,
    },
  })

  if (
    !nextDueDate ||
    lancamento.assinaturaPagar.status !== 'ATIVA' ||
    !lancamento.assinaturaPagar.gerarFinanceiro ||
    !lancamento.assinaturaPagar.gerarAutomatico
  ) {
    return {
      linked: true,
      generated: false,
      nextDueDate,
      lancamentoId: null as number | null,
    }
  }

  const generated = await garantirLancamentoAtualAssinaturaPagar(db, lancamento.assinaturaPagar.id)

  return {
    linked: true,
    generated: generated.created || Boolean(generated.lancamentoId),
    nextDueDate,
    lancamentoId: generated.lancamentoId,
  }
}
