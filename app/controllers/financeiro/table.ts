import { Request, Response } from 'express'
import { prisma } from '../../utils/prisma'
import { Prisma } from '../../../generated'
import { getCustomRequest } from '../../helpers/getCustomRequest'
import { isAccountOverdue } from '../../routers/web'
import { parseFinanceiroFilters } from './queryFilters'

function resolveSortField(value: unknown) {
  const sortBy = typeof value === 'string' ? value : 'dataLancamento'

  switch (sortBy) {
    case 'Uid':
      return 'Uid'
    case 'tipo':
      return 'tipo'
    case 'status':
      return 'status'
    case 'descricao':
      return 'descricao'
    case 'valorTotal':
      return 'valorTotal'
    case 'dataLancamento':
      return 'dataLancamento'
    case 'categoriaId':
      return 'categoriaId'
    case 'createdAt':
      return 'createdAt'
    default:
      return 'dataLancamento'
  }
}

function resolveSortOrder(value: unknown): 'asc' | 'desc' {
  return value === 'desc' ? 'desc' : 'asc'
}

function buildLancamentoWhere(
  contaId: number,
  filters: ReturnType<typeof parseFinanceiroFilters>,
): Prisma.LancamentoFinanceiroWhereInput {
  const where: Prisma.LancamentoFinanceiroWhereInput = {
    contaId,
  }

  if (filters.tipo !== 'TODOS') {
    where.tipo = filters.tipo
  }

  if (filters.status !== 'TODOS') {
    where.status = filters.status
  }

  if (filters.origem && filters.origem !== 'TODOS') {
    where.origemSistema = filters.origem
  }

  if (filters.contaFinanceiraId) {
    where.contasFinanceiroId = filters.contaFinanceiraId
  }

  if (filters.categoriaId) {
    where.categoriaId = filters.categoriaId
  }

  if (filters.clienteId) {
    where.clienteId = filters.clienteId
  }

  if (filters.inicio || filters.fim) {
    where.dataLancamento = {
      ...(filters.inicio ? { gte: filters.inicio } : {}),
      ...(filters.fim ? { lte: filters.fim } : {}),
    }
  }

  if (filters.search) {
    where.OR = [
      { descricao: { contains: filters.search } },
      { Uid: { contains: filters.search } },
      { venda: { Uid: { contains: filters.search } } },
      { categoria: { nome: { contains: filters.search } } },
      { cliente: { nome: { contains: filters.search } } },
      { ContasFinanceiro: { nome: { contains: filters.search } } },
      { assinaturaPagar: { nomeServico: { contains: filters.search } } },
    ]
  }

  return where
}

export const tableFinanceiro = async (
  req: Request,
  res: Response,
): Promise<any> => {
  const customData = getCustomRequest(req).customData
  if (await isAccountOverdue(req)) {
    return res.status(404).json({
      message: 'Conta inativa ou bloqueada, verifique seu plano',
    })
  }

  const page = parseInt(req.query.page as string) || 1
  const pageSize = parseInt(req.query.pageSize as string) || 10
  const filters = parseFinanceiroFilters(req)
  const sortBy = resolveSortField(req.query.sortBy)
  const order = resolveSortOrder(req.query.order)

  const where = buildLancamentoWhere(customData.contaId, filters)

  const [total, data] = await Promise.all([
    prisma.lancamentoFinanceiro.count({ where }),
    prisma.lancamentoFinanceiro.findMany({
      where,
      include: {
        parcelas: true,
        categoria: true,
        cliente: true,
        ContasFinanceiro: true,
        assinaturaPagar: {
          select: { id: true, nomeServico: true, icone: true, corDestaque: true },
        },
      },
      orderBy: { [sortBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  })
}
