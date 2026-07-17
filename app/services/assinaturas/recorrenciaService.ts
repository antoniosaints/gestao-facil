import { addDays, addMonths, addWeeks, addYears, format, subDays } from 'date-fns'

import { prisma } from '../../utils/prisma'
import { criarLancamentoFinanceiro } from '../financeiro/lancamentoService'
import { generateCobrancaAbacatePay } from '../../controllers/financeiro/abacatePay/gerarCobranca'
import { generateCobrancaMercadoPago } from '../../controllers/financeiro/mercadoPago/gerarCobranca'

export type AutomaticGateway = 'mercadopago' | 'abacatepay' | 'asaas' | 'pagseguro'
export type AutomaticBillingType = 'PIX' | 'BOLETO' | 'LINK'

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
    case 'BIMESTRAL':
      return { kind: 'months' as const, value: 2 }
    case 'TRIMESTRAL':
      return { kind: 'months' as const, value: 3 }
    case 'SEMESTRAL':
      return { kind: 'months' as const, value: 6 }
    case 'ANUAL':
      return { kind: 'years' as const, value: 1 }
    case 'PERSONALIZADO':
      return { kind: 'days' as const, value: intervaloDias || 30 }
    case 'MENSAL':
    default:
      return { kind: 'months' as const, value: 1 }
  }
}

function advanceDate(base: Date, periodicidade: string, intervaloDias?: number | null) {
  const step = getPeriodStep(periodicidade, intervaloDias)
  if (step.kind === 'days') return addDays(base, step.value)
  if (step.kind === 'weeks') return addWeeks(base, step.value)
  if (step.kind === 'years') return addYears(base, step.value)
  return addMonths(base, step.value)
}

function getCyclePeriod(base: Date, periodicidade: string, intervaloDias?: number | null) {
  const nextStart = advanceDate(base, periodicidade, intervaloDias)
  return {
    inicioPeriodo: base,
    fimPeriodo: subDays(nextStart, 1),
    proximaCobranca: nextStart,
  }
}

function getCycleReference(base: Date, periodicidade: string) {
  if (periodicidade === 'SEMANAL' || periodicidade === 'QUINZENAL' || periodicidade === 'PERSONALIZADO') {
    return format(base, 'yyyy-MM-dd')
  }

  return format(base, 'yyyy-MM')
}

type CycleItem = {
  quantidade: number
  valorUnitario: number
  cobrar?: boolean
  ativo?: boolean
  modoCobranca?: 'MENSALIDADE' | 'UNICA' | 'PARCELADA'
  cobrarVezes?: number | null
  vezesCobradas?: number | null
}

function itemLineValue(item: CycleItem) {
  return Number(item.quantidade || 0) * Number(item.valorUnitario || 0)
}

function isBillable(item: CycleItem) {
  return item.cobrar !== false && item.ativo !== false
}

// Valor recorrente (mensalidade): somente itens MENSALIDADE compõem o valor de todo ciclo.
function calculateItemsValue(items: Array<CycleItem>) {
  return items
    .filter(isBillable)
    .filter((item) => (item.modoCobranca ?? 'MENSALIDADE') === 'MENSALIDADE')
    .reduce((acc, item) => acc + itemLineValue(item), 0)
}

// Um item pontual (UNICA/PARCELADA) ainda deve ser cobrado neste ciclo?
function isOneOffDueThisCycle(item: CycleItem) {
  if (!isBillable(item)) return false
  const mode = item.modoCobranca ?? 'MENSALIDADE'
  const vezesCobradas = Number(item.vezesCobradas ?? 0)
  if (mode === 'UNICA') return vezesCobradas < 1
  if (mode === 'PARCELADA') return vezesCobradas < Number(item.cobrarVezes ?? 0)
  return false
}

// Soma dos adicionais pontuais devidos neste ciclo (única / parcelada ainda dentro do limite).
function calculateOneOffItemsValue(items: Array<CycleItem>) {
  return items.filter(isOneOffDueThisCycle).reduce((acc, item) => acc + itemLineValue(item), 0)
}

function resolveSubscriptionValue(args: {
  modoValor: 'MANUAL' | 'DINAMICO'
  valorManual?: number | null
  planBaseValue?: number | null
  itens: Array<CycleItem>
}) {
  if (args.modoValor === 'MANUAL') {
    return Number(args.valorManual ?? args.planBaseValue ?? 0)
  }

  const itensValue = calculateItemsValue(args.itens)
  if (itensValue > 0) return itensValue
  return Number(args.planBaseValue ?? 0)
}

async function registerHistory(
  assinaturaId: number,
  usuarioId: number | null,
  evento: string,
  payload?: Record<string, unknown>,
) {
  await prisma.assinaturaHistorico.create({
    data: {
      assinaturaId,
      usuarioId: usuarioId || null,
      evento,
      payloadJson: payload ? JSON.stringify(payload) : null,
    },
  })
}

function resolveFormaPagamento(tipoCobranca?: string | null) {
  if (tipoCobranca === 'BOLETO') return 'BOLETO' as const
  return 'PIX' as const
}

async function ensureFinancialContext(
  contaId: number,
  overrides?: { contaFinanceiraId?: number | null; categoriaId?: number | null },
) {
  // Usa a categoria/conta escolhidas no contrato quando setadas (validando o dono); senão, fallback para a primeira.
  const [categoria, contaFinanceira] = await Promise.all([
    prisma.categoriaFinanceiro.findFirst({
      where: { contaId, ...(overrides?.categoriaId ? { id: overrides.categoriaId } : {}) },
      orderBy: { id: 'asc' },
    }),
    prisma.contasFinanceiro.findFirst({
      where: { contaId, ...(overrides?.contaFinanceiraId ? { id: overrides.contaFinanceiraId } : {}) },
      orderBy: { id: 'asc' },
    }),
  ])

  if (!categoria) {
    throw new Error('Nenhuma categoria financeira encontrada para gerar o lançamento automático da assinatura.')
  }

  if (!contaFinanceira) {
    throw new Error('Nenhuma conta financeira encontrada para gerar o lançamento automático da assinatura.')
  }

  return { categoria, contaFinanceira }
}

export async function gerarLancamentoFinanceiroAutomatico(cicloId: number, usuarioId: number | null) {
  const ciclo = await prisma.assinaturaCiclo.findUniqueOrThrow({
    where: { id: cicloId },
    include: {
      assinatura: {
        include: {
          cliente: true,
        },
      },
    },
  })

  if (ciclo.lancamentoFinanceiroId) {
    return { lancamentoId: ciclo.lancamentoFinanceiroId, parcelaId: null }
  }

  const { categoria, contaFinanceira } = await ensureFinancialContext(ciclo.assinatura.contaId, {
    contaFinanceiraId: ciclo.assinatura.contaFinanceiraId,
    categoriaId: ciclo.assinatura.categoriaId,
  })

  const result = await prisma.$transaction(async (tx) => {
    const created = await criarLancamentoFinanceiro(
      tx as never,
      ciclo.assinatura.contaId,
      {
        descricao: `Assinatura ${ciclo.assinatura.Uid} • ${ciclo.assinatura.nomeContrato} • ${ciclo.referencia}`,
        valorTotal: toNumber(ciclo.valorCobrado),
        tipo: 'RECEITA',
        formaPagamento: resolveFormaPagamento(ciclo.assinatura.tipoCobranca),
        status: 'PENDENTE',
        clienteId: ciclo.assinatura.clienteId,
        categoriaId: categoria.id,
        dataLancamento: ciclo.inicioPeriodo,
        parcelas: 1,
        contasFinanceiroId: contaFinanceira.id,
        tipoLancamentoModo: 'AVISTA',
      },
      { skipNotification: true },
    )

    const parcela = await tx.parcelaFinanceiro.findFirst({
      where: { lancamentoId: created.id, numero: 1 },
      orderBy: { id: 'asc' },
    })

    await tx.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { lancamentoFinanceiroId: created.id },
    })

    return {
      lancamentoId: created.id,
      parcelaId: parcela?.id ?? null,
    }
  })

  await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_LANCAMENTO_FINANCEIRO_GERADO', {
    cicloId,
    lancamentoFinanceiroId: result.lancamentoId,
    parcelaId: result.parcelaId,
  })

  return result
}

export async function gerarCobrancaAutomatica(cicloId: number, usuarioId: number | null, parcelaId?: number | null) {
  const ciclo = await prisma.assinaturaCiclo.findUniqueOrThrow({
    where: { id: cicloId },
    include: {
      assinatura: true,
      cobrancaFinanceira: true,
    },
  })

  if (
    ciclo.cobrancaFinanceiraId &&
    ciclo.cobrancaFinanceira &&
    !['CANCELADO', 'ESTORNADO'].includes(ciclo.cobrancaFinanceira.status)
  ) {
    return { cobrancaId: ciclo.cobrancaFinanceiraId }
  }

  const gateway = ciclo.assinatura.gateway as AutomaticGateway | null
  const tipoCobranca = ciclo.assinatura.tipoCobranca as AutomaticBillingType | null

  if (!gateway || !tipoCobranca) {
    await prisma.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { status: 'FALHA' },
    })
    await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_COBRANCA_AUTOMATICA_FALHOU', {
      cicloId,
      motivo: 'Gateway ou tipo de cobrança não configurado.',
    })
    return { cobrancaId: null }
  }

  const parametros = await prisma.parametrosConta.findUnique({
    where: { contaId: ciclo.assinatura.contaId },
  })

  if (!parametros) {
    await prisma.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { status: 'FALHA' },
    })
    await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_COBRANCA_AUTOMATICA_FALHOU', {
      cicloId,
      gateway,
      tipoCobranca,
      motivo: 'Parâmetros de integração não encontrados para a conta.',
    })
    return { cobrancaId: null }
  }

  const generated =
    gateway === 'abacatepay'
      ? await generateCobrancaAbacatePay(
          {
            type: tipoCobranca,
            value: toNumber(ciclo.valorCobrado),
            gateway: 'abacatepay',
            clienteId: ciclo.assinatura.clienteId,
            vinculo: parcelaId ? { id: parcelaId, tipo: 'parcela' } : undefined,
          },
          ciclo.assinatura.contaId,
        )
      : gateway === 'mercadopago'
        ? await generateCobrancaMercadoPago(
            {
              type: tipoCobranca,
              value: toNumber(ciclo.valorCobrado),
              gateway: 'mercadopago',
              clienteId: ciclo.assinatura.clienteId,
              vinculo: parcelaId ? { id: parcelaId, tipo: 'parcela' } : undefined,
            },
            parametros,
          )
        : null

  if (!generated) {
    await prisma.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { status: 'FALHA' },
    })
    await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_COBRANCA_AUTOMATICA_FALHOU', {
      cicloId,
      gateway,
      tipoCobranca,
      motivo: 'Gateway ainda não suportado na automação recorrente.',
    })
    return { cobrancaId: null }
  }

  if (!generated.chargeId) {
    await prisma.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { status: 'FALHA' },
    })
    await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_COBRANCA_AUTOMATICA_FALHOU', {
      cicloId,
      gateway,
      tipoCobranca,
      motivo: 'A cobrança foi enviada ao gateway, mas não foi possível vinculá-la ao ciclo.',
    })
    return { cobrancaId: null }
  }

  await prisma.assinaturaCiclo.update({
    where: { id: ciclo.id },
    data: {
      cobrancaFinanceiraId: generated.chargeId,
      status: 'COBRADO',
    },
  })

  await registerHistory(ciclo.assinaturaId, usuarioId, 'CICLO_COBRANCA_AUTOMATICA_GERADA', {
    cicloId,
    cobrancaFinanceiraId: generated.chargeId,
    gateway,
    tipoCobranca,
    gatewayReference: generated.gatewayReference,
    paymentLink: generated.paymentLink,
  })

  return { cobrancaId: generated.chargeId }
}

async function executarAutomacoesDoCiclo(cicloId: number, usuarioId: number | null) {
  const ciclo = await prisma.assinaturaCiclo.findUniqueOrThrow({
    where: { id: cicloId },
    include: {
      assinatura: true,
    },
  })

  let parcelaId: number | null = null

  if (ciclo.assinatura.gerarLancamentoFinanceiro) {
    const financeiro = await gerarLancamentoFinanceiroAutomatico(ciclo.id, usuarioId)
    parcelaId = financeiro.parcelaId ?? null
  }

  if (ciclo.assinatura.cobrancaAutomatica) {
    await gerarCobrancaAutomatica(ciclo.id, usuarioId, parcelaId)
  }
}

export async function createCycleForSubscription(
  assinaturaId: number,
  usuarioId: number | null,
  options?: { forceReferenceDate?: Date },
) {
  const assinatura = await prisma.assinaturaCliente.findUniqueOrThrow({
    where: { id: assinaturaId },
    include: {
      plano: true,
      itens: true,
    },
  })

  const referenceDate = options?.forceReferenceDate ?? new Date(assinatura.proximaCobranca)
  const referencia = getCycleReference(referenceDate, assinatura.periodicidade)

  const existente = await prisma.assinaturaCiclo.findFirst({
    where: {
      assinaturaId: assinatura.id,
      referencia,
    },
  })

  if (existente) {
    return existente
  }

  const cycleItems: CycleItem[] = assinatura.itens.map((item) => ({
    quantidade: item.quantidade,
    valorUnitario: Number(item.valorUnitario),
    cobrar: item.cobrar,
    ativo: item.ativo,
    modoCobranca: item.modoCobranca,
    cobrarVezes: item.cobrarVezes,
    vezesCobradas: item.vezesCobradas,
  }))

  // Valor recorrente (mensalidade) + adicionais pontuais devidos neste ciclo (única / parcelada).
  const valorRecorrente = resolveSubscriptionValue({
    modoValor: assinatura.modoValor,
    valorManual: assinatura.valorManual ? Number(assinatura.valorManual) : null,
    planBaseValue: assinatura.plano ? Number(assinatura.plano.valorBase) : null,
    itens: cycleItems,
  })
  const valorAdicionais = calculateOneOffItemsValue(cycleItems)
  const valorResolvido = valorRecorrente + valorAdicionais

  // Itens pontuais efetivamente incluídos neste ciclo — precisam ter o contador incrementado.
  const itensPontuaisCobrados = assinatura.itens.filter((item) =>
    isOneOffDueThisCycle({
      quantidade: item.quantidade,
      valorUnitario: Number(item.valorUnitario),
      cobrar: item.cobrar,
      ativo: item.ativo,
      modoCobranca: item.modoCobranca,
      cobrarVezes: item.cobrarVezes,
      vezesCobradas: item.vezesCobradas,
    }),
  )

  const periodo = getCyclePeriod(referenceDate, assinatura.periodicidade, assinatura.intervaloDiasPersonalizado)

  const ciclo = await prisma.assinaturaCiclo.create({
    data: {
      assinaturaId: assinatura.id,
      referencia,
      inicioPeriodo: periodo.inicioPeriodo,
      fimPeriodo: periodo.fimPeriodo,
      valorCalculado: valorResolvido,
      valorCobrado: valorResolvido,
      status: 'PENDENTE',
      gatewayUsado: assinatura.gateway,
      tipoCobrancaUsado: assinatura.tipoCobranca,
    },
  })

  await prisma.assinaturaCliente.update({
    where: { id: assinatura.id },
    data: {
      proximaCobranca: periodo.proximaCobranca,
    },
  })

  if (itensPontuaisCobrados.length) {
    await prisma.assinaturaItem.updateMany({
      where: { id: { in: itensPontuaisCobrados.map((item) => item.id) } },
      data: { vezesCobradas: { increment: 1 } },
    })
  }

  await registerHistory(assinatura.id, usuarioId, 'CICLO_GERADO', {
    cicloId: ciclo.id,
    referencia,
    valorCobrado: valorResolvido,
    valorRecorrente,
    valorAdicionais,
    itensPontuaisCobrados: itensPontuaisCobrados.map((item) => item.id),
  })

  try {
    await executarAutomacoesDoCiclo(ciclo.id, usuarioId)
  } catch (error: any) {
    await prisma.assinaturaCiclo.update({
      where: { id: ciclo.id },
      data: { status: 'FALHA' },
    })
    await registerHistory(assinatura.id, usuarioId, 'CICLO_AUTOMACAO_FALHOU', {
      cicloId: ciclo.id,
      erro: error?.message || 'Falha desconhecida ao automatizar o ciclo.',
    })
  }

  return prisma.assinaturaCiclo.findUniqueOrThrow({ where: { id: ciclo.id } })
}

export async function processDueSubscriptionCycles() {
  const now = new Date()
  const assinaturas = await prisma.assinaturaCliente.findMany({
    where: {
      status: 'ATIVA',
      proximaCobranca: { lte: now },
      OR: [
        { recorrenciaIndefinida: true },
        { fim: null },
        { fim: { gte: now } },
      ],
    },
    select: {
      id: true,
      Uid: true,
      nomeContrato: true,
      proximaCobranca: true,
    },
    orderBy: { proximaCobranca: 'asc' },
  })

  const result = {
    checked: assinaturas.length,
    created: 0,
    failed: 0,
    errors: [] as string[],
  }

  for (const assinatura of assinaturas) {
    try {
      await createCycleForSubscription(assinatura.id, null, {
        forceReferenceDate: new Date(assinatura.proximaCobranca),
      })
      result.created += 1
    } catch (error: any) {
      result.failed += 1
      result.errors.push(`${assinatura.Uid} - ${error?.message || 'Falha desconhecida.'}`)
    }
  }

  return result
}

export async function syncCycleStatusFromCharge(cobrancaFinanceiraId: number, status: 'PENDENTE' | 'COBRADO' | 'PAGO' | 'ATRASADO' | 'CANCELADO' | 'FALHA') {
  const ciclo = await prisma.assinaturaCiclo.findFirst({
    where: { cobrancaFinanceiraId },
  })

  if (!ciclo) return false

  await prisma.assinaturaCiclo.update({
    where: { id: ciclo.id },
    data: { status },
  })

  await registerHistory(ciclo.assinaturaId, null, 'CICLO_STATUS_SINCRONIZADO_GATEWAY', {
    cicloId: ciclo.id,
    cobrancaFinanceiraId,
    status,
  })

  return true
}
