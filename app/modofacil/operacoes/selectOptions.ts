import { z } from 'zod';
import type { PrismaClient } from '../../../generated';
import { parsePage } from '../../utils/pagination';

export type OptionKind = 'finance-accounts' | 'finance-categories' | 'product-categories';
type OptionsDb = Pick<PrismaClient, 'contasFinanceiro' | 'categoriaFinanceiro' | 'produtoCategoria'>;
const querySchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  excludeId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(191).optional(),
  page: z.unknown().optional(),
});
export async function selectOptions(db: OptionsDb, contaId: number, kind: OptionKind, query: unknown) {
  const input = querySchema.parse(query);
  const size = 20;
  const where = {
    contaId,
    ...(input.id ? { id: input.id } : {}),
    ...(input.excludeId ? { NOT: { id: input.excludeId } } : {}),
    ...(!input.id && input.search ? { OR: [{ nome: { contains: input.search } }, { Uid: { contains: input.search } }] } : {}),
  };
  const args = {
    where,
    select: { id: true, nome: true },
    orderBy: [{ nome: 'asc' as const }, { id: 'asc' as const }],
    skip: input.id ? 0 : (parsePage(input.page) - 1) * size,
    take: input.id ? 1 : size + 1,
  };
  const rows = kind === 'finance-accounts' ? await db.contasFinanceiro.findMany(args)
    : kind === 'finance-categories' ? await db.categoriaFinanceiro.findMany(args)
    : await db.produtoCategoria.findMany(args);
  return { results: rows.slice(0, size).map((row) => ({ id: row.id, label: row.nome })), hasMore: !input.id && rows.length > size };
}
