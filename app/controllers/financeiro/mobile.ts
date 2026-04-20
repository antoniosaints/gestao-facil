import { Request, Response } from 'express'
import { getCustomRequest } from '../../helpers/getCustomRequest'
import { prisma } from '../../utils/prisma'
import { Prisma } from '../../../generated'
import { parseFinanceiroFilters } from './queryFilters'

function buildLancamentoWhere(
  contaId: number,
  filters: ReturnType<typeof parseFinanceiroFilters>,
): Prisma.LancamentoFinanceiroWhereInput {
  const where: Prisma.LancamentoFinanceiroWhereInput = { contaId }

  if (filters.tipo !== 'TODOS') {
    where.tipo = filters.tipo
  }

  if (filters.status !== 'TODOS') {
    where.status = filters.status
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
      { categoria: { nome: { contains: filters.search } } },
      { cliente: { nome: { contains: filters.search } } },
      { ContasFinanceiro: { nome: { contains: filters.search } } },
    ]
  }

  return where
}

export const ListagemMobileLancamentos = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData
  const { limit = '10', page = '1' } = req.query as { limit: string; page: string }

  try {
    const filters = parseFinanceiroFilters(req)
    const where = buildLancamentoWhere(customData.contaId, filters)

    const take = Number(limit)
    const skip = (Number(page) - 1) * take

    const [data, total] = await Promise.all([
      prisma.lancamentoFinanceiro.findMany({
        where,
        skip,
        take,
        orderBy: { dataLancamento: 'desc' },
        include: {
          parcelas: true,
          categoria: true,
          cliente: true,
          ContasFinanceiro: true,
        },
      }),
      prisma.lancamentoFinanceiro.count({ where }),
    ])

    const totalPages = Math.ceil(total / take)

    res.json({
      data,
      pagination: {
        total,
        page: Number(page),
        limit: take,
        totalPages,
      },
    })
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Erro ao buscar os dados' })
  }
}
