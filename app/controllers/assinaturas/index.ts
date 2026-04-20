import { Request, Response } from 'express'
import { addDays, addMonths, addWeeks, addYears, format, subDays } from 'date-fns'
import { z } from 'zod'

import { prisma } from '../../utils/prisma'
import { getCustomRequest } from '../../helpers/getCustomRequest'
import { hasPermission } from '../../helpers/userPermission'
import { gerarIdUnicoComMetaFinal } from '../../helpers/generateUUID'
import { createCycleForSubscription as createRecurringCycleForSubscription } from '../../services/assinaturas/recorrenciaService'

const planoItemSchema = z.object({
  tipoItem: z.enum(['SERVICO', 'PRODUTO']),
  servicoId: z.number().int().positive().optional().nullable(),
  produtoId: z.number().int().positive().optional().nullable(),
  descricaoSnapshot: z.string().trim().min(1),
  quantidade: z.number().int().positive().default(1),
  valorUnitario: z.number().min(0),
  cobrar: z.boolean().default(true),
  comodato: z.boolean().default(false),
})

const planoSchema = z.object({
  id: z.number().int().positive().optional(),
  nome: z.string().trim().min(2),
  descricao: z.string().trim().optional().nullable(),
  status: z.enum(['ATIVO', 'INATIVO']).default('ATIVO'),
  periodicidadePadrao: z
    .enum(['SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO'])
    .default('MENSAL'),
  intervaloDiasPadrao: z.number().int().positive().optional().nullable(),
  valorBase: z.number().min(0).default(0),
  modoValorPadrao: z.enum(['MANUAL', 'DINAMICO']).default('DINAMICO'),
  gatewayPadrao: z.enum(['mercadopago', 'asaas', 'pagseguro']).optional().nullable(),
  tipoCobrancaPadrao: z.enum(['PIX', 'BOLETO', 'LINK']).optional().nullable(),
  itens: z.array(planoItemSchema).default([]),
})

const assinaturaItemSchema = z.object({
  tipoItem: z.enum(['SERVICO', 'PRODUTO']),
  servicoId: z.number().int().positive().optional().nullable(),
  produtoId: z.number().int().positive().optional().nullable(),
  descricaoSnapshot: z.string().trim().min(1),
  quantidade: z.number().int().positive().default(1),
  valorUnitario: z.number().min(0),
  cobrar: z.boolean().default(true),
  comodato: z.boolean().default(false),
  ativo: z.boolean().default(true),
  identificacao: z.string().trim().optional().nullable(),
  dataPrevistaDevolucao: z.string().datetime().optional().nullable(),
  observacoes: z.string().trim().optional().nullable(),
})

const assinaturaSchema = z.object({
  id: z.number().int().positive().optional(),
  clienteId: z.number().int().positive(),
  planoId: z.number().int().positive().optional().nullable(),
  nomeContrato: z.string().trim().min(2),
  status: z.enum(['ATIVA', 'SUSPENSA', 'CANCELADA', 'ENCERRADA']).default('ATIVA'),
  modoValor: z.enum(['MANUAL', 'DINAMICO']).default('DINAMICO'),
  valorManual: z.number().min(0).optional().nullable(),
  periodicidade: z
    .enum(['SEMANAL', 'QUINZENAL', 'MENSAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'PERSONALIZADO'])
    .default('MENSAL'),
  intervaloDiasPersonalizado: z.number().int().positive().optional().nullable(),
  inicio: z.string().datetime(),
  fim: z.string().datetime().optional().nullable(),
  recorrenciaIndefinida: z.boolean().default(true),
  proximaCobranca: z.string().datetime().optional().nullable(),
  cobrancaAutomatica: z.boolean().default(false),
  gateway: z.enum(['mercadopago', 'asaas', 'pagseguro']).optional().nullable(),
  tipoCobranca: z.enum(['PIX', 'BOLETO', 'LINK']).optional().nullable(),
  gerarLancamentoFinanceiro: z.boolean().default(false),
  observacoes: z.string().trim().optional().nullable(),
  itens: z.array(assinaturaItemSchema).default([]),
  gerarPrimeiroCiclo: z.boolean().default(true),
})

const updateStatusSchema = z.object({
  status: z.enum(['ATIVA', 'SUSPENSA', 'CANCELADA', 'ENCERRADA']),
})

const updateCicloStatusSchema = z.object({
  status: z.enum(['PENDENTE', 'COBRADO', 'PAGO', 'ATRASADO', 'CANCELADO', 'FALHA']),
})

const updateComodatoStatusSchema = z.object({
  status: z.enum(['EM_USO', 'DEVOLVIDO', 'PERDIDO', 'AVARIADO']),
})

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

function calculateItemsValue(items: Array<{ quantidade: number; valorUnitario: number; cobrar?: boolean; ativo?: boolean }>) {
  return items
    .filter((item) => item.cobrar !== false && item.ativo !== false)
    .reduce((acc, item) => acc + Number(item.quantidade || 0) * Number(item.valorUnitario || 0), 0)
}

function resolveSubscriptionValue(args: {
  modoValor: 'MANUAL' | 'DINAMICO'
  valorManual?: number | null
  planBaseValue?: number | null
  itens: Array<{ quantidade: number; valorUnitario: number; cobrar?: boolean; ativo?: boolean }>
}) {
  if (args.modoValor === 'MANUAL') {
    return Number(args.valorManual ?? args.planBaseValue ?? 0)
  }

  const itensValue = calculateItemsValue(args.itens)
  if (itensValue > 0) return itensValue
  return Number(args.planBaseValue ?? 0)
}

function normalizeSearch(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function ensurePermission(req: Request, res: Response) {
  const allowed = await hasPermission(getCustomRequest(req).customData, 3)
  if (!allowed) {
    res.status(403).json({ message: 'Sem permissão para acessar o módulo de assinaturas.' })
    return false
  }

  return true
}

async function registerHistory(
  assinaturaId: number,
  usuarioId: number,
  evento: string,
  payload?: Record<string, unknown>,
) {
  await prisma.assinaturaHistorico.create({
    data: {
      assinaturaId,
      usuarioId,
      evento,
      payloadJson: payload ? JSON.stringify(payload) : null,
    },
  })
}

async function createCycleForSubscription(
  assinaturaId: number,
  usuarioId: number,
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

  const valorResolvido = resolveSubscriptionValue({
    modoValor: assinatura.modoValor,
    valorManual: assinatura.valorManual ? Number(assinatura.valorManual) : null,
    planBaseValue: assinatura.plano ? Number(assinatura.plano.valorBase) : null,
    itens: assinatura.itens.map((item) => ({
      quantidade: item.quantidade,
      valorUnitario: Number(item.valorUnitario),
      cobrar: item.cobrar,
      ativo: item.ativo,
    })),
  })

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

  await registerHistory(assinatura.id, usuarioId, 'CICLO_GERADO', {
    cicloId: ciclo.id,
    referencia,
    valorCobrado: valorResolvido,
  })

  return ciclo
}

export async function getAssinaturasDashboard(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const hoje = new Date()

  const [
    total,
    ativas,
    suspensas,
    canceladas,
    ciclosPendentes,
    ciclosAtrasados,
    comodatosEmUso,
    assinaturas,
    proximosCiclos,
  ] = await Promise.all([
    prisma.assinaturaCliente.count({ where: { contaId } }),
    prisma.assinaturaCliente.count({ where: { contaId, status: 'ATIVA' } }),
    prisma.assinaturaCliente.count({ where: { contaId, status: 'SUSPENSA' } }),
    prisma.assinaturaCliente.count({ where: { contaId, status: { in: ['CANCELADA', 'ENCERRADA'] } } }),
    prisma.assinaturaCiclo.count({ where: { assinatura: { contaId }, status: { in: ['PENDENTE', 'COBRADO'] } } }),
    prisma.assinaturaCiclo.count({
      where: {
        assinatura: { contaId },
        status: 'ATRASADO',
      },
    }),
    prisma.assinaturaComodato.count({ where: { assinaturaItem: { assinatura: { contaId } }, status: 'EM_USO' } }),
    prisma.assinaturaCliente.findMany({
      where: { contaId, status: 'ATIVA' },
      include: { plano: true, itens: true },
    }),
    prisma.assinaturaCliente.findMany({
      where: { contaId },
      include: {
        cliente: true,
        plano: true,
        itens: true,
      },
      orderBy: { proximaCobranca: 'asc' },
      take: 6,
    }),
  ])

  const mrrEstimado = assinaturas.reduce((acc, assinatura) => {
    const valorBase = resolveSubscriptionValue({
      modoValor: assinatura.modoValor,
      valorManual: assinatura.valorManual ? Number(assinatura.valorManual) : null,
      planBaseValue: assinatura.plano ? Number(assinatura.plano.valorBase) : null,
      itens: assinatura.itens.map((item) => ({
        quantidade: item.quantidade,
        valorUnitario: Number(item.valorUnitario),
        cobrar: item.cobrar,
        ativo: item.ativo,
      })),
    })

    switch (assinatura.periodicidade) {
      case 'SEMANAL':
        return acc + valorBase * 4
      case 'QUINZENAL':
        return acc + valorBase * 2
      case 'BIMESTRAL':
        return acc + valorBase / 2
      case 'TRIMESTRAL':
        return acc + valorBase / 3
      case 'SEMESTRAL':
        return acc + valorBase / 6
      case 'ANUAL':
        return acc + valorBase / 12
      default:
        return acc + valorBase
    }
  }, 0)

  const inadimplencia = await prisma.assinaturaCiclo.aggregate({
    where: {
      assinatura: { contaId },
      status: 'ATRASADO',
    },
    _sum: { valorCobrado: true },
  })

  return res.json({
    data: {
      kpis: {
        totalAssinaturas: total,
        assinaturasAtivas: ativas,
        assinaturasSuspensas: suspensas,
        assinaturasCanceladas: canceladas,
        mrrEstimado,
        inadimplencia: toNumber(inadimplencia._sum.valorCobrado),
        cobrancasPendentes: ciclosPendentes,
        cobrancasAtrasadas: ciclosAtrasados,
        comodatosEmUso,
      },
      proximosVencimentos: proximosCiclos.map((item) => ({
        id: item.id,
        Uid: item.Uid,
        nomeContrato: item.nomeContrato,
        cliente: item.cliente?.nome || 'Cliente não informado',
        plano: item.plano?.nome || null,
        proximaCobranca: item.proximaCobranca,
        valorPrevisto: resolveSubscriptionValue({
          modoValor: item.modoValor,
          valorManual: item.valorManual ? Number(item.valorManual) : null,
          planBaseValue: item.plano ? Number(item.plano.valorBase) : null,
          itens: item.itens.map((subItem) => ({
            quantidade: subItem.quantidade,
            valorUnitario: Number(subItem.valorUnitario),
            cobrar: subItem.cobrar,
            ativo: subItem.ativo,
          })),
        }),
        status: item.status,
        atrasada: new Date(item.proximaCobranca) < hoje && item.status === 'ATIVA',
      })),
    },
  })
}

export async function getAssinaturasOpcoes(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData

  const [clientes, servicos, produtos] = await Promise.all([
    prisma.clientesFornecedores.findMany({
      where: { contaId, tipo: 'CLIENTE' },
      select: { id: true, nome: true, Uid: true },
      take: 100,
      orderBy: { nome: 'asc' },
    }),
    prisma.servicos.findMany({
      where: { contaId },
      select: { id: true, nome: true, preco: true, Uid: true },
      take: 100,
      orderBy: { nome: 'asc' },
    }),
    prisma.produto.findMany({
      where: { contaId },
      select: { id: true, nome: true, nomeVariante: true, preco: true, Uid: true },
      take: 100,
      orderBy: [{ nome: 'asc' }, { nomeVariante: 'asc' }],
    }),
  ])

  return res.json({
    data: {
      clientes: clientes.map((item) => ({ id: item.id, label: `${item.nome} • ${item.Uid}` })),
      servicos: servicos.map((item) => ({ id: item.id, label: `${item.nome} • ${toNumber(item.preco).toFixed(2)}` })),
      produtos: produtos.map((item) => ({
        id: item.id,
        label: `${item.nome}${item.nomeVariante ? ` / ${item.nomeVariante}` : ''} • ${toNumber(item.preco).toFixed(2)}`,
      })),
    },
  })
}

export async function getPlanosAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const search = normalizeSearch(req.query.search)
  const status = normalizeSearch(req.query.status)

  const data = await prisma.planoAssinatura.findMany({
    where: {
      contaId,
      ...(search
        ? {
            OR: [
              { nome: { contains: search } },
              { descricao: { contains: search } },
              { Uid: { contains: search } },
            ],
          }
        : {}),
      ...(status && status !== 'TODOS' ? { status: status as 'ATIVO' | 'INATIVO' } : {}),
    },
    include: {
      itens: true,
      _count: { select: { assinaturas: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return res.json({
    data: data.map((item) => ({
      id: item.id,
      Uid: item.Uid,
      nome: item.nome,
      descricao: item.descricao,
      status: item.status,
      periodicidadePadrao: item.periodicidadePadrao,
      intervaloDiasPadrao: item.intervaloDiasPadrao,
      valorBase: toNumber(item.valorBase),
      modoValorPadrao: item.modoValorPadrao,
      gatewayPadrao: item.gatewayPadrao,
      tipoCobrancaPadrao: item.tipoCobrancaPadrao,
      itens: item.itens.map((subItem) => ({
        id: subItem.id,
        tipoItem: subItem.tipoItem,
        servicoId: subItem.servicoId,
        produtoId: subItem.produtoId,
        descricaoSnapshot: subItem.descricaoSnapshot,
        quantidade: subItem.quantidade,
        valorUnitario: toNumber(subItem.valorUnitario),
        cobrar: subItem.cobrar,
        comodato: subItem.comodato,
      })),
      resumo: {
        itens: item.itens.length,
        itensCobrados: item.itens.filter((subItem) => subItem.cobrar).length,
        assinaturasVinculadas: item._count.assinaturas,
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  })
}

export async function savePlanoAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const parsed = planoSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Dados inválidos para o plano.' })
  }

  const { contaId } = getCustomRequest(req).customData
  const payload = parsed.data

  if (payload.id) {
    const existing = await prisma.planoAssinatura.findFirst({ where: { id: payload.id, contaId } })
    if (!existing) {
      return res.status(404).json({ message: 'Plano não encontrado.' })
    }
  }

  const plano = await prisma.$transaction(async (tx) => {
    const saved = payload.id
      ? await tx.planoAssinatura.update({
          where: { id: payload.id },
          data: {
            nome: payload.nome,
            descricao: payload.descricao || null,
            status: payload.status,
            periodicidadePadrao: payload.periodicidadePadrao,
            intervaloDiasPadrao: payload.intervaloDiasPadrao || null,
            valorBase: payload.valorBase,
            modoValorPadrao: payload.modoValorPadrao,
            gatewayPadrao: payload.gatewayPadrao || null,
            tipoCobrancaPadrao: payload.tipoCobrancaPadrao || null,
          },
        })
      : await tx.planoAssinatura.create({
          data: {
            contaId,
            Uid: gerarIdUnicoComMetaFinal('PLA'),
            nome: payload.nome,
            descricao: payload.descricao || null,
            status: payload.status,
            periodicidadePadrao: payload.periodicidadePadrao,
            intervaloDiasPadrao: payload.intervaloDiasPadrao || null,
            valorBase: payload.valorBase,
            modoValorPadrao: payload.modoValorPadrao,
            gatewayPadrao: payload.gatewayPadrao || null,
            tipoCobrancaPadrao: payload.tipoCobrancaPadrao || null,
          },
        })

    await tx.planoAssinaturaItem.deleteMany({ where: { planoId: saved.id } })

    if (payload.itens.length) {
      await tx.planoAssinaturaItem.createMany({
        data: payload.itens.map((item) => ({
          planoId: saved.id,
          tipoItem: item.tipoItem,
          servicoId: item.servicoId || null,
          produtoId: item.produtoId || null,
          descricaoSnapshot: item.descricaoSnapshot,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          cobrar: item.cobrar,
          comodato: item.comodato,
        })),
      })
    }

    return saved
  })

  return res.json({ message: payload.id ? 'Plano atualizado com sucesso.' : 'Plano criado com sucesso.', data: plano })
}

export async function getAssinaturas(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const search = normalizeSearch(req.query.search)
  const status = normalizeSearch(req.query.status)

  const data = await prisma.assinaturaCliente.findMany({
    where: {
      contaId,
      ...(status && status !== 'TODOS'
        ? { status: status as 'ATIVA' | 'SUSPENSA' | 'CANCELADA' | 'ENCERRADA' }
        : {}),
      ...(search
        ? {
            OR: [
              { nomeContrato: { contains: search } },
              { Uid: { contains: search } },
              { cliente: { nome: { contains: search } } },
            ],
          }
        : {}),
    },
    include: {
      cliente: true,
      plano: true,
      itens: true,
      ciclos: {
        orderBy: { createdAt: 'desc' },
        take: 3,
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return res.json({
    data: data.map((item) => {
      const valorAtual = resolveSubscriptionValue({
        modoValor: item.modoValor,
        valorManual: item.valorManual ? Number(item.valorManual) : null,
        planBaseValue: item.plano ? Number(item.plano.valorBase) : null,
        itens: item.itens.map((subItem) => ({
          quantidade: subItem.quantidade,
          valorUnitario: Number(subItem.valorUnitario),
          cobrar: subItem.cobrar,
          ativo: subItem.ativo,
        })),
      })

      return {
        id: item.id,
        Uid: item.Uid,
        nomeContrato: item.nomeContrato,
        status: item.status,
        modoValor: item.modoValor,
        valorManual: item.valorManual ? toNumber(item.valorManual) : null,
        valorAtual,
        periodicidade: item.periodicidade,
        intervaloDiasPersonalizado: item.intervaloDiasPersonalizado,
        inicio: item.inicio,
        fim: item.fim,
        recorrenciaIndefinida: item.recorrenciaIndefinida,
        proximaCobranca: item.proximaCobranca,
        cobrancaAutomatica: item.cobrancaAutomatica,
        gateway: item.gateway,
        tipoCobranca: item.tipoCobranca,
        observacoes: item.observacoes,
        cliente: item.cliente ? { id: item.cliente.id, nome: item.cliente.nome } : null,
        plano: item.plano ? { id: item.plano.id, nome: item.plano.nome } : null,
        resumo: {
          itens: item.itens.length,
          ciclosRecentes: item.ciclos.length,
          pendencias: item.ciclos.filter((cycle) => ['PENDENTE', 'ATRASADO'].includes(cycle.status)).length,
        },
      }
    }),
  })
}

export async function saveAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const parsed = assinaturaSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Dados inválidos para a assinatura.' })
  }

  const payload = parsed.data
  const { contaId, userId } = getCustomRequest(req).customData

  const plan = payload.planoId
    ? await prisma.planoAssinatura.findFirst({
        where: { id: payload.planoId, contaId },
        include: { itens: true },
      })
    : null

  const itemsToPersist = payload.itens.length
    ? payload.itens
    : (plan?.itens || []).map((item) => ({
        tipoItem: item.tipoItem,
        servicoId: item.servicoId,
        produtoId: item.produtoId,
        descricaoSnapshot: item.descricaoSnapshot,
        quantidade: item.quantidade,
        valorUnitario: Number(item.valorUnitario),
        cobrar: item.cobrar,
        comodato: item.comodato,
        ativo: true,
        identificacao: null,
        dataPrevistaDevolucao: null,
        observacoes: null,
      }))

  if (!itemsToPersist.length && payload.modoValor === 'DINAMICO' && !plan) {
    return res.status(400).json({ message: 'Assinaturas dinâmicas exigem ao menos um item ou um plano base.' })
  }

  if (payload.id) {
    const existing = await prisma.assinaturaCliente.findFirst({ where: { id: payload.id, contaId } })
    if (!existing) {
      return res.status(404).json({ message: 'Assinatura não encontrada.' })
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const assinatura = payload.id
      ? await tx.assinaturaCliente.update({
          where: { id: payload.id },
          data: {
            clienteId: payload.clienteId,
            planoId: payload.planoId || null,
            nomeContrato: payload.nomeContrato,
            status: payload.status,
            modoValor: payload.modoValor,
            valorManual: payload.valorManual ?? null,
            periodicidade: payload.periodicidade,
            intervaloDiasPersonalizado: payload.intervaloDiasPersonalizado || null,
            inicio: new Date(payload.inicio),
            fim: payload.fim ? new Date(payload.fim) : null,
            recorrenciaIndefinida: payload.recorrenciaIndefinida,
            proximaCobranca: payload.proximaCobranca ? new Date(payload.proximaCobranca) : new Date(payload.inicio),
            cobrancaAutomatica: payload.cobrancaAutomatica,
            gateway: payload.gateway || null,
            tipoCobranca: payload.tipoCobranca || null,
            gerarLancamentoFinanceiro: payload.gerarLancamentoFinanceiro,
            observacoes: payload.observacoes || null,
          },
        })
      : await tx.assinaturaCliente.create({
          data: {
            contaId,
            Uid: gerarIdUnicoComMetaFinal('ASC'),
            clienteId: payload.clienteId,
            planoId: payload.planoId || null,
            nomeContrato: payload.nomeContrato,
            status: payload.status,
            modoValor: payload.modoValor,
            valorManual: payload.valorManual ?? null,
            periodicidade: payload.periodicidade,
            intervaloDiasPersonalizado: payload.intervaloDiasPersonalizado || null,
            inicio: new Date(payload.inicio),
            fim: payload.fim ? new Date(payload.fim) : null,
            recorrenciaIndefinida: payload.recorrenciaIndefinida,
            proximaCobranca: payload.proximaCobranca ? new Date(payload.proximaCobranca) : new Date(payload.inicio),
            cobrancaAutomatica: payload.cobrancaAutomatica,
            gateway: payload.gateway || null,
            tipoCobranca: payload.tipoCobranca || null,
            gerarLancamentoFinanceiro: payload.gerarLancamentoFinanceiro,
            observacoes: payload.observacoes || null,
          },
        })

    await tx.assinaturaComodato.deleteMany({ where: { assinaturaItem: { assinaturaId: assinatura.id } } })
    await tx.assinaturaItem.deleteMany({ where: { assinaturaId: assinatura.id } })

    for (const item of itemsToPersist) {
      const assinaturaItem = await tx.assinaturaItem.create({
        data: {
          assinaturaId: assinatura.id,
          tipoItem: item.tipoItem,
          servicoId: item.servicoId || null,
          produtoId: item.produtoId || null,
          descricaoSnapshot: item.descricaoSnapshot,
          quantidade: item.quantidade,
          valorUnitario: item.valorUnitario,
          cobrar: item.cobrar,
          comodato: item.comodato,
          ativo: item.ativo,
        },
      })

      if (item.comodato && item.produtoId) {
        await tx.assinaturaComodato.create({
          data: {
            assinaturaItemId: assinaturaItem.id,
            produtoId: item.produtoId,
            quantidade: item.quantidade,
            identificacao: item.identificacao || null,
            status: 'EM_USO',
            dataEntrega: new Date(payload.inicio),
            dataPrevistaDevolucao: item.dataPrevistaDevolucao ? new Date(item.dataPrevistaDevolucao) : null,
            observacoes: item.observacoes || null,
          },
        })
      }
    }

    return assinatura
  })

  await registerHistory(saved.id, userId, payload.id ? 'ASSINATURA_ATUALIZADA' : 'ASSINATURA_CRIADA', {
    nomeContrato: payload.nomeContrato,
    planoId: payload.planoId || null,
    itens: itemsToPersist.length,
  })

  if (payload.gerarPrimeiroCiclo && saved.status === 'ATIVA') {
    await createRecurringCycleForSubscription(saved.id, userId, {
      forceReferenceDate: payload.proximaCobranca ? new Date(payload.proximaCobranca) : new Date(payload.inicio),
    })
  }

  return res.json({
    message: payload.id ? 'Assinatura atualizada com sucesso.' : 'Assinatura criada com sucesso.',
    data: { id: saved.id },
  })
}

export async function getAssinaturaDetalhe(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const id = Number(req.params.id)
  if (!id) {
    return res.status(400).json({ message: 'ID de assinatura inválido.' })
  }

  const data = await prisma.assinaturaCliente.findFirst({
    where: { id, contaId },
    include: {
      cliente: true,
      plano: { include: { itens: true } },
      itens: {
        include: {
          servico: true,
          produto: true,
          comodatos: {
            include: { produto: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      ciclos: {
        include: {
          cobrancaFinanceira: true,
          lancamentoFinanceiro: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      historico: {
        include: { Autor: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!data) {
    return res.status(404).json({ message: 'Assinatura não encontrada.' })
  }

  const valorAtual = resolveSubscriptionValue({
    modoValor: data.modoValor,
    valorManual: data.valorManual ? Number(data.valorManual) : null,
    planBaseValue: data.plano ? Number(data.plano.valorBase) : null,
    itens: data.itens.map((item) => ({
      quantidade: item.quantidade,
      valorUnitario: Number(item.valorUnitario),
      cobrar: item.cobrar,
      ativo: item.ativo,
    })),
  })

  return res.json({
    data: {
      id: data.id,
      Uid: data.Uid,
      nomeContrato: data.nomeContrato,
      status: data.status,
      modoValor: data.modoValor,
      valorManual: data.valorManual ? toNumber(data.valorManual) : null,
      valorAtual,
      periodicidade: data.periodicidade,
      intervaloDiasPersonalizado: data.intervaloDiasPersonalizado,
      inicio: data.inicio,
      fim: data.fim,
      recorrenciaIndefinida: data.recorrenciaIndefinida,
      proximaCobranca: data.proximaCobranca,
      cobrancaAutomatica: data.cobrancaAutomatica,
      gateway: data.gateway,
      tipoCobranca: data.tipoCobranca,
      gerarLancamentoFinanceiro: data.gerarLancamentoFinanceiro,
      observacoes: data.observacoes,
      cliente: data.cliente ? { id: data.cliente.id, nome: data.cliente.nome, Uid: data.cliente.Uid } : null,
      plano: data.plano
        ? {
            id: data.plano.id,
            nome: data.plano.nome,
            valorBase: toNumber(data.plano.valorBase),
            periodicidadePadrao: data.plano.periodicidadePadrao,
          }
        : null,
      resumo: {
        itens: data.itens.length,
        itensCobrados: data.itens.filter((item) => item.cobrar && item.ativo).length,
        comodatos: data.itens.reduce((acc, item) => acc + item.comodatos.length, 0),
        ciclosPendentes: data.ciclos.filter((item) => item.status === 'PENDENTE').length,
        ciclosAtrasados: data.ciclos.filter((item) => item.status === 'ATRASADO').length,
        historico: data.historico.length,
      },
      itens: data.itens.map((item) => ({
        id: item.id,
        tipoItem: item.tipoItem,
        servicoId: item.servicoId,
        produtoId: item.produtoId,
        descricaoSnapshot: item.descricaoSnapshot,
        quantidade: item.quantidade,
        valorUnitario: toNumber(item.valorUnitario),
        cobrar: item.cobrar,
        comodato: item.comodato,
        ativo: item.ativo,
        servico: item.servico ? { id: item.servico.id, nome: item.servico.nome } : null,
        produto: item.produto ? { id: item.produto.id, nome: item.produto.nome, variante: item.produto.nomeVariante } : null,
        comodatos: item.comodatos.map((comodato) => ({
          id: comodato.id,
          quantidade: comodato.quantidade,
          identificacao: comodato.identificacao,
          status: comodato.status,
          dataEntrega: comodato.dataEntrega,
          dataPrevistaDevolucao: comodato.dataPrevistaDevolucao,
          dataDevolucao: comodato.dataDevolucao,
          observacoes: comodato.observacoes,
          produto: comodato.produto ? { id: comodato.produto.id, nome: comodato.produto.nome, variante: comodato.produto.nomeVariante } : null,
        })),
      })),
      ciclos: data.ciclos.map((item) => ({
        id: item.id,
        referencia: item.referencia,
        inicioPeriodo: item.inicioPeriodo,
        fimPeriodo: item.fimPeriodo,
        valorCalculado: toNumber(item.valorCalculado),
        valorCobrado: toNumber(item.valorCobrado),
        status: item.status,
        cobrancaFinanceiraId: item.cobrancaFinanceiraId,
        lancamentoFinanceiroId: item.lancamentoFinanceiroId,
        gatewayUsado: item.gatewayUsado,
        tipoCobrancaUsado: item.tipoCobrancaUsado,
        createdAt: item.createdAt,
      })),
      historico: data.historico.map((item) => ({
        id: item.id,
        evento: item.evento,
        payloadJson: item.payloadJson,
        autor: item.Autor?.nome || 'Sistema',
        createdAt: item.createdAt,
      })),
    },
  })
}

export async function updateAssinaturaStatus(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const parsed = updateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Status inválido.' })
  }

  const { contaId, userId } = getCustomRequest(req).customData
  const id = Number(req.params.id)
  const assinatura = await prisma.assinaturaCliente.findFirst({ where: { id, contaId } })

  if (!assinatura) {
    return res.status(404).json({ message: 'Assinatura não encontrada.' })
  }

  await prisma.assinaturaCliente.update({
    where: { id },
    data: { status: parsed.data.status },
  })

  await registerHistory(id, userId, 'STATUS_ALTERADO', {
    from: assinatura.status,
    to: parsed.data.status,
  })

  return res.json({ message: 'Status da assinatura atualizado com sucesso.' })
}

export async function gerarCicloAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId, userId } = getCustomRequest(req).customData
  const id = Number(req.params.id)
  const assinatura = await prisma.assinaturaCliente.findFirst({ where: { id, contaId } })

  if (!assinatura) {
    return res.status(404).json({ message: 'Assinatura não encontrada.' })
  }

  if (assinatura.status !== 'ATIVA') {
    return res.status(400).json({ message: 'Somente assinaturas ativas podem gerar novos ciclos.' })
  }

  const ciclo = await createRecurringCycleForSubscription(id, userId)
  return res.json({ message: 'Ciclo gerado com sucesso.', data: { id: ciclo.id } })
}

export async function getCobrancasAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const search = normalizeSearch(req.query.search)
  const status = normalizeSearch(req.query.status)

  const data = await prisma.assinaturaCiclo.findMany({
    where: {
      assinatura: {
        contaId,
        ...(search
          ? {
              OR: [
                { nomeContrato: { contains: search } },
                { Uid: { contains: search } },
                { cliente: { nome: { contains: search } } },
              ],
            }
          : {}),
      },
      ...(status && status !== 'TODOS'
        ? { status: status as 'PENDENTE' | 'COBRADO' | 'PAGO' | 'ATRASADO' | 'CANCELADO' | 'FALHA' }
        : {}),
    },
    include: {
      assinatura: {
        include: {
          cliente: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return res.json({
    data: data.map((item) => ({
      id: item.id,
      referencia: item.referencia,
      inicioPeriodo: item.inicioPeriodo,
      fimPeriodo: item.fimPeriodo,
      valorCalculado: toNumber(item.valorCalculado),
      valorCobrado: toNumber(item.valorCobrado),
      status: item.status,
      gatewayUsado: item.gatewayUsado,
      tipoCobrancaUsado: item.tipoCobrancaUsado,
      createdAt: item.createdAt,
      assinatura: {
        id: item.assinatura.id,
        Uid: item.assinatura.Uid,
        nomeContrato: item.assinatura.nomeContrato,
        cliente: item.assinatura.cliente?.nome || 'Cliente não informado',
      },
    })),
  })
}

export async function updateCicloAssinaturaStatus(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const parsed = updateCicloStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Status de cobrança inválido.' })
  }

  const { contaId, userId } = getCustomRequest(req).customData
  const id = Number(req.params.id)
  const ciclo = await prisma.assinaturaCiclo.findFirst({
    where: { id, assinatura: { contaId } },
  })

  if (!ciclo) {
    return res.status(404).json({ message: 'Cobrança não encontrada.' })
  }

  await prisma.assinaturaCiclo.update({ where: { id }, data: { status: parsed.data.status } })
  await registerHistory(ciclo.assinaturaId, userId, 'CICLO_STATUS_ALTERADO', {
    cicloId: ciclo.id,
    from: ciclo.status,
    to: parsed.data.status,
  })

  return res.json({ message: 'Status da cobrança atualizado com sucesso.' })
}

export async function getComodatosAssinatura(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const { contaId } = getCustomRequest(req).customData
  const search = normalizeSearch(req.query.search)
  const status = normalizeSearch(req.query.status)

  const data = await prisma.assinaturaComodato.findMany({
    where: {
      assinaturaItem: {
        assinatura: {
          contaId,
          ...(search
            ? {
                OR: [
                  { nomeContrato: { contains: search } },
                  { Uid: { contains: search } },
                  { cliente: { nome: { contains: search } } },
                ],
              }
            : {}),
        },
      },
      ...(status && status !== 'TODOS'
        ? { status: status as 'EM_USO' | 'DEVOLVIDO' | 'PERDIDO' | 'AVARIADO' }
        : {}),
    },
    include: {
      produto: true,
      assinaturaItem: {
        include: {
          assinatura: {
            include: {
              cliente: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return res.json({
    data: data.map((item) => ({
      id: item.id,
      quantidade: item.quantidade,
      identificacao: item.identificacao,
      status: item.status,
      dataEntrega: item.dataEntrega,
      dataPrevistaDevolucao: item.dataPrevistaDevolucao,
      dataDevolucao: item.dataDevolucao,
      observacoes: item.observacoes,
      produto: item.produto ? { id: item.produto.id, nome: item.produto.nome, variante: item.produto.nomeVariante } : null,
      assinatura: {
        id: item.assinaturaItem.assinatura.id,
        Uid: item.assinaturaItem.assinatura.Uid,
        nomeContrato: item.assinaturaItem.assinatura.nomeContrato,
        cliente: item.assinaturaItem.assinatura.cliente?.nome || 'Cliente não informado',
      },
    })),
  })
}

export async function updateComodatoAssinaturaStatus(req: Request, res: Response): Promise<any> {
  if (!(await ensurePermission(req, res))) return

  const parsed = updateComodatoStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Status de comodato inválido.' })
  }

  const { contaId, userId } = getCustomRequest(req).customData
  const id = Number(req.params.id)
  const comodato = await prisma.assinaturaComodato.findFirst({
    where: { id, assinaturaItem: { assinatura: { contaId } } },
    include: { assinaturaItem: true },
  })

  if (!comodato) {
    return res.status(404).json({ message: 'Comodato não encontrado.' })
  }

  await prisma.assinaturaComodato.update({
    where: { id },
    data: {
      status: parsed.data.status,
      dataDevolucao: parsed.data.status === 'DEVOLVIDO' ? new Date() : null,
    },
  })

  await registerHistory(comodato.assinaturaItem.assinaturaId, userId, 'COMODATO_STATUS_ALTERADO', {
    comodatoId: comodato.id,
    from: comodato.status,
    to: parsed.data.status,
  })

  return res.json({ message: 'Status do comodato atualizado com sucesso.' })
}
