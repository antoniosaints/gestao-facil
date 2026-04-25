import { Request, Response } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../../generated/client'

import { prisma } from '../../utils/prisma'
import { getCustomRequest } from '../../helpers/getCustomRequest'
import { hasPermission } from '../../helpers/userPermission'
import { gerarIdUnicoComMetaFinal } from '../../helpers/generateUUID'
import { sendFinanceiroUpdated } from '../../hooks/financeiro/socket'
import {
  buildAssinaturaPagarReference,
  garantirLancamentoAtualAssinaturaPagar,
} from '../../services/financeiro/assinaturasPagarService'
import { decimalToNumber } from './queryFilters'

const assinaturaPagarLinkSchema = z.object({
  titulo: z.string().trim().min(1, 'Informe o título do link.'),
  url: z.string().trim().url('Informe uma URL válida para o link.'),
})

const assinaturaPagarSchema = z.object({
  id: z.number().int().positive().optional(),
  nomeServico: z.string().trim().min(2, 'Informe o nome do serviço.'),
  valor: z.number().positive('Informe um valor maior que zero.'),
  periodicidade: z.enum(['SEMANAL', 'QUINZENAL', 'MENSAL', 'ANUAL', 'PERSONALIZADO']).default('MENSAL'),
  intervaloDiasPersonalizado: z.number().int().positive().nullable().optional(),
  inicio: z.string().datetime('Informe a data de início.'),
  fim: z.string().datetime().nullable().optional(),
  proximoVencimento: z.string().datetime('Informe a data de vencimento.'),
  status: z.enum(['ATIVA', 'INATIVA', 'CANCELADA']).default('ATIVA'),
  gerarFinanceiro: z.boolean().default(false),
  gerarAutomatico: z.boolean().default(false),
  contaFinanceiraId: z.number().int().positive().nullable().optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  formaPagamento: z
    .enum(['PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO', 'DEBITO', 'GATEWAY', 'OUTRO'])
    .nullable()
    .optional(),
  corDestaque: z.string().trim().nullable().optional(),
  observacoes: z.string().trim().nullable().optional(),
  links: z.array(assinaturaPagarLinkSchema).default([]),
})

const assinaturaPagarStatusSchema = z.object({
  status: z.enum(['ATIVA', 'INATIVA', 'CANCELADA']),
})

function parsePage(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseSearch(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseStatus(value: unknown) {
  if (value === 'ATIVA' || value === 'INATIVA' || value === 'CANCELADA') return value
  return 'TODOS'
}

function parseSortOrder(value: unknown): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc'
}

function resolveSortField(value: unknown) {
  switch (value) {
    case 'nomeServico':
    case 'valor':
    case 'status':
    case 'proximoVencimento':
    case 'createdAt':
      return value
    default:
      return 'updatedAt'
  }
}

async function ensureFinancePermission(customData: ReturnType<typeof getCustomRequest>['customData']) {
  const allowed = await hasPermission(customData, 3)
  if (!allowed) {
    throw new Error('Sem permissão para acessar assinaturas a pagar.')
  }
}

function normalizeColor(value?: string | null) {
  if (!value) return null
  const normalized = value.trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null
  return normalized.toUpperCase()
}

function buildWhere(contaId: number, req: Request): Prisma.AssinaturaPagarWhereInput {
  const search = parseSearch(req.query.search)
  const status = parseStatus(req.query.status)

  const where: AssinaturaPagarWhere = { contaId }

  if (status !== 'TODOS') {
    where.status = status
  }

  if (search) {
    where.OR = [
      { nomeServico: { contains: search } },
      { Uid: { contains: search } },
      { observacoes: { contains: search } },
      { links: { some: { titulo: { contains: search } } } },
      { links: { some: { url: { contains: search } } } },
    ]
  }

  return where
}

function mapAssinaturaPagar(item: any) {
  const referenciaAtual = item.proximoVencimento
    ? buildAssinaturaPagarReference(new Date(item.proximoVencimento), item.periodicidade)
    : null

  const lancamentoAtual = referenciaAtual
    ? item.lancamentos.find((lancamento: any) => lancamento.referenciaRecorrencia === referenciaAtual)
    : null

  return {
    id: item.id,
    Uid: item.Uid,
    nomeServico: item.nomeServico,
    valor: decimalToNumber(item.valor),
    periodicidade: item.periodicidade,
    intervaloDiasPersonalizado: item.intervaloDiasPersonalizado,
    inicio: item.inicio,
    fim: item.fim,
    proximoVencimento: item.proximoVencimento,
    status: item.status,
    gerarFinanceiro: item.gerarFinanceiro,
    gerarAutomatico: item.gerarAutomatico,
    contaFinanceiraId: item.contaFinanceiraId,
    categoriaId: item.categoriaId,
    formaPagamento: item.formaPagamento,
    icone: item.icone,
    corDestaque: item.corDestaque,
    observacoes: item.observacoes,
    links: item.links.map((link: any) => ({
      id: link.id,
      titulo: link.titulo,
      url: link.url,
    })),
    resumo: {
      links: item.links.length,
      lancamentos: item.lancamentos.length,
      pendentes: item.lancamentos.filter((lancamento: any) => ['PENDENTE', 'PARCIAL', 'ATRASADO'].includes(lancamento.status)).length,
      pagos: item.lancamentos.filter((lancamento: any) => lancamento.status === 'PAGO').length,
    },
    lancamentoAtual: lancamentoAtual
      ? {
          id: lancamentoAtual.id,
          status: lancamentoAtual.status,
          referenciaRecorrencia: lancamentoAtual.referenciaRecorrencia,
          dataLancamento: lancamentoAtual.dataLancamento,
        }
      : null,
  }
}

async function validateFinanceContext(contaId: number, payload: z.infer<typeof assinaturaPagarSchema>) {
  if (!payload.gerarFinanceiro) return

  if (!payload.contaFinanceiraId || !payload.categoriaId) {
    throw new Error('Conta financeira e categoria são obrigatórias quando a assinatura gera financeiro.')
  }

  const [contaFinanceira, categoria] = await Promise.all([
    prisma.contasFinanceiro.findFirst({
      where: { id: payload.contaFinanceiraId, contaId },
      select: { id: true },
    }),
    prisma.categoriaFinanceiro.findFirst({
      where: { id: payload.categoriaId, contaId },
      select: { id: true },
    }),
  ])

  if (!contaFinanceira) {
    throw new Error('Conta financeira inválida para esta conta.')
  }

  if (!categoria) {
    throw new Error('Categoria financeira inválida para esta conta.')
  }
}

function validateBusinessRules(payload: z.infer<typeof assinaturaPagarSchema>) {
  const inicio = new Date(payload.inicio)
  const proximoVencimento = new Date(payload.proximoVencimento)
  const fim = payload.fim ? new Date(payload.fim) : null

  if (Number.isNaN(inicio.getTime()) || Number.isNaN(proximoVencimento.getTime())) {
    throw new Error('Informe datas válidas para início e vencimento.')
  }

  if (proximoVencimento < inicio) {
    throw new Error('O vencimento não pode ser anterior à data de início.')
  }

  if (fim && fim < inicio) {
    throw new Error('A data de fim não pode ser anterior à data de início.')
  }

  if (fim && proximoVencimento > fim) {
    throw new Error('O vencimento atual não pode ultrapassar a data final da assinatura.')
  }

  if (payload.periodicidade === 'PERSONALIZADO') {
    if (!payload.intervaloDiasPersonalizado || payload.intervaloDiasPersonalizado < 1) {
      throw new Error('Informe o intervalo personalizado em dias.')
    }
  }

  if (!payload.gerarFinanceiro && payload.gerarAutomatico) {
    throw new Error('A geração automática só pode ser usada quando a assinatura também gera financeiro.')
  }
}

export const getAssinaturasPagar = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const where = buildWhere(customData.contaId, req)

    const data = await prisma.assinaturaPagar.findMany({
      where,
      include: {
        links: true,
        lancamentos: {
          select: {
            id: true,
            status: true,
            referenciaRecorrencia: true,
            dataLancamento: true,
          },
          orderBy: { dataLancamento: 'desc' },
        },
      },
      orderBy: [{ proximoVencimento: 'asc' }, { nomeServico: 'asc' }],
    })

    return res.json({ data: data.map(mapAssinaturaPagar) })
  } catch (error: any) {
    return res.status(403).json({ message: error?.message || 'Erro ao carregar assinaturas a pagar.' })
  }
}

export const getAssinaturasPagarTable = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const page = parsePage(req.query.page, 1)
    const pageSize = parsePage(req.query.pageSize, 10)
    const order = parseSortOrder(req.query.order)
    const sortBy = resolveSortField(req.query.sortBy)
    const where = buildWhere(customData.contaId, req)

    const [total, data] = await Promise.all([
      prisma.assinaturaPagar.count({ where }),
      prisma.assinaturaPagar.findMany({
        where,
        include: {
          links: true,
          lancamentos: {
            select: {
              id: true,
              status: true,
              referenciaRecorrencia: true,
              dataLancamento: true,
            },
            orderBy: { dataLancamento: 'desc' },
          },
        },
        orderBy: { [sortBy]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return res.json({
      data: data.map(mapAssinaturaPagar),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error: any) {
    return res.status(403).json({ message: error?.message || 'Erro ao carregar a tabela de assinaturas a pagar.' })
  }
}

export const getAssinaturasPagarMobile = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const page = parsePage(req.query.page, 1)
    const limit = parsePage(req.query.limit, 10)
    const where = buildWhere(customData.contaId, req)

    const [total, data] = await Promise.all([
      prisma.assinaturaPagar.count({ where }),
      prisma.assinaturaPagar.findMany({
        where,
        include: {
          links: true,
          lancamentos: {
            select: {
              id: true,
              status: true,
              referenciaRecorrencia: true,
              dataLancamento: true,
            },
            orderBy: { dataLancamento: 'desc' },
          },
        },
        orderBy: [{ proximoVencimento: 'asc' }, { nomeServico: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return res.json({
      data: data.map(mapAssinaturaPagar),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    return res.status(403).json({ message: error?.message || 'Erro ao carregar assinaturas a pagar.' })
  }
}

export const getAssinaturaPagarDetalhe = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' })
    }

    const data = await prisma.assinaturaPagar.findFirst({
      where: { id, contaId: customData.contaId },
      include: {
        links: true,
        contaFinanceira: {
          select: { id: true, nome: true },
        },
        categoria: {
          select: { id: true, nome: true },
        },
        lancamentos: {
          select: {
            id: true,
            Uid: true,
            status: true,
            referenciaRecorrencia: true,
            dataLancamento: true,
            valorTotal: true,
          },
          orderBy: { dataLancamento: 'desc' },
          take: 12,
        },
      },
    })

    if (!data) {
      return res.status(404).json({ message: 'Assinatura a pagar não encontrada.' })
    }

    return res.json({
      data: {
        ...mapAssinaturaPagar(data),
        contaFinanceira: data.contaFinanceira,
        categoria: data.categoria,
        lancamentos: data.lancamentos.map((item) => ({
          id: item.id,
          Uid: item.Uid,
          status: item.status,
          referenciaRecorrencia: item.referenciaRecorrencia,
          dataLancamento: item.dataLancamento,
          valorTotal: decimalToNumber(item.valorTotal),
        })),
      },
    })
  } catch (error: any) {
    return res.status(403).json({ message: error?.message || 'Erro ao carregar a assinatura a pagar.' })
  }
}

export const saveAssinaturaPagar = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const parsed = assinaturaPagarSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Dados inválidos.' })
    }

    validateBusinessRules(parsed.data)
    await validateFinanceContext(customData.contaId, parsed.data)

    if (parsed.data.id) {
      const existing = await prisma.assinaturaPagar.findFirst({
        where: { id: parsed.data.id, contaId: customData.contaId },
        select: { id: true },
      })

      if (!existing) {
        return res.status(404).json({ message: 'Assinatura a pagar não encontrada.' })
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const assinatura = parsed.data.id
        ? await tx.assinaturaPagar.update({
            where: { id: parsed.data.id },
            data: {
              nomeServico: parsed.data.nomeServico,
              valor: parsed.data.valor,
              periodicidade: parsed.data.periodicidade,
              intervaloDiasPersonalizado:
                parsed.data.periodicidade === 'PERSONALIZADO'
                  ? parsed.data.intervaloDiasPersonalizado || null
                  : null,
              inicio: new Date(parsed.data.inicio),
              fim: parsed.data.fim ? new Date(parsed.data.fim) : null,
              proximoVencimento: new Date(parsed.data.proximoVencimento),
              status: parsed.data.status,
              gerarFinanceiro: parsed.data.gerarFinanceiro,
              gerarAutomatico: parsed.data.gerarAutomatico,
              contaFinanceiraId: parsed.data.gerarFinanceiro ? parsed.data.contaFinanceiraId || null : null,
              categoriaId: parsed.data.gerarFinanceiro ? parsed.data.categoriaId || null : null,
              formaPagamento: parsed.data.gerarFinanceiro ? parsed.data.formaPagamento || 'PIX' : null,
              corDestaque: normalizeColor(parsed.data.corDestaque),
              observacoes: parsed.data.observacoes || null,
            },
          })
        : await tx.assinaturaPagar.create({
            data: {
              contaId: customData.contaId,
              Uid: gerarIdUnicoComMetaFinal('ASP'),
              nomeServico: parsed.data.nomeServico,
              valor: parsed.data.valor,
              periodicidade: parsed.data.periodicidade,
              intervaloDiasPersonalizado:
                parsed.data.periodicidade === 'PERSONALIZADO'
                  ? parsed.data.intervaloDiasPersonalizado || null
                  : null,
              inicio: new Date(parsed.data.inicio),
              fim: parsed.data.fim ? new Date(parsed.data.fim) : null,
              proximoVencimento: new Date(parsed.data.proximoVencimento),
              status: parsed.data.status,
              gerarFinanceiro: parsed.data.gerarFinanceiro,
              gerarAutomatico: parsed.data.gerarAutomatico,
              contaFinanceiraId: parsed.data.gerarFinanceiro ? parsed.data.contaFinanceiraId || null : null,
              categoriaId: parsed.data.gerarFinanceiro ? parsed.data.categoriaId || null : null,
              formaPagamento: parsed.data.gerarFinanceiro ? parsed.data.formaPagamento || 'PIX' : null,
              corDestaque: normalizeColor(parsed.data.corDestaque),
              observacoes: parsed.data.observacoes || null,
            },
          })

      await tx.assinaturaPagarLink.deleteMany({ where: { assinaturaPagarId: assinatura.id } })

      if (parsed.data.links.length) {
        await tx.assinaturaPagarLink.createMany({
          data: parsed.data.links.map((link) => ({
            assinaturaPagarId: assinatura.id,
            titulo: link.titulo.trim(),
            url: link.url.trim(),
          })),
        })
      }

      const financeiro =
        assinatura.gerarFinanceiro && assinatura.status === 'ATIVA'
          ? await garantirLancamentoAtualAssinaturaPagar(tx, assinatura.id)
          : null

      return { assinatura, financeiro }
    })

    if (result.financeiro?.lancamentoId) {
      sendFinanceiroUpdated(customData.contaId, {
        reason: result.financeiro.created ? 'assinatura-pagar-financeiro-gerado' : 'assinatura-pagar-financeiro-vinculado',
        assinaturaPagarId: result.assinatura.id,
        lancamentoId: result.financeiro.lancamentoId,
      })
    }

    return res.json({
      message: parsed.data.id ? 'Assinatura a pagar atualizada com sucesso.' : 'Assinatura a pagar criada com sucesso.',
      data: {
        id: result.assinatura.id,
        financeiroGerado: Boolean(result.financeiro?.lancamentoId),
        lancamentoId: result.financeiro?.lancamentoId || null,
      },
    })
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Erro ao salvar a assinatura a pagar.' })
  }
}

export const deleteAssinaturaPagar = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' })
    }

    const assinatura = await prisma.assinaturaPagar.findFirst({
      where: { id, contaId: customData.contaId },
      include: {
        _count: {
          select: {
            lancamentos: true,
          },
        },
      },
    })

    if (!assinatura) {
      return res.status(404).json({ message: 'Assinatura a pagar não encontrada.' })
    }

    if (assinatura._count.lancamentos > 0) {
      return res.status(400).json({
        message: 'A assinatura já possui lançamentos vinculados. Cancele ou inative para preservar o histórico financeiro.',
      })
    }

    await prisma.assinaturaPagar.delete({ where: { id } })

    return res.json({ message: 'Assinatura a pagar excluída com sucesso.' })
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Erro ao excluir a assinatura a pagar.' })
  }
}

export const updateAssinaturaPagarStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const id = Number(req.params.id)
    const parsed = assinaturaPagarStatusSchema.safeParse(req.body)

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' })
    }

    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0]?.message || 'Status inválido.' })
    }

    const assinatura = await prisma.assinaturaPagar.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true },
    })

    if (!assinatura) {
      return res.status(404).json({ message: 'Assinatura a pagar não encontrada.' })
    }

    await prisma.assinaturaPagar.update({
      where: { id },
      data: { status: parsed.data.status },
    })

    return res.json({ message: 'Status da assinatura atualizado com sucesso.' })
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Erro ao atualizar o status.' })
  }
}

export const gerarFinanceiroAssinaturaPagar = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData
    await ensureFinancePermission(customData)

    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'ID inválido.' })
    }

    const assinatura = await prisma.assinaturaPagar.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true, status: true, gerarFinanceiro: true },
    })

    if (!assinatura) {
      return res.status(404).json({ message: 'Assinatura a pagar não encontrada.' })
    }

    if (assinatura.status !== 'ATIVA') {
      return res.status(400).json({ message: 'Somente assinaturas ativas podem gerar financeiro.' })
    }

    if (!assinatura.gerarFinanceiro) {
      return res.status(400).json({ message: 'Ative “Gerar financeiro” na assinatura antes de continuar.' })
    }

    const generated = await prisma.$transaction(async (tx) => garantirLancamentoAtualAssinaturaPagar(tx, id))

    if (generated.lancamentoId) {
      sendFinanceiroUpdated(customData.contaId, {
        reason: generated.created ? 'assinatura-pagar-financeiro-gerado-manual' : 'assinatura-pagar-financeiro-existente',
        assinaturaPagarId: id,
        lancamentoId: generated.lancamentoId,
      })
    }

    return res.json({
      message: generated.created
        ? 'Lançamento financeiro gerado com sucesso.'
        : 'Já existe um lançamento financeiro para o ciclo atual dessa assinatura.',
      data: {
        lancamentoId: generated.lancamentoId,
        referencia: generated.reference,
      },
    })
  } catch (error: any) {
    return res.status(400).json({ message: error?.message || 'Erro ao gerar o financeiro da assinatura.' })
  }
}
