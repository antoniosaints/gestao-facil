import type { Prisma, Status } from '../../../generated';

export function buildPeopleWhere(contaId: number, query: Record<string, unknown>): Prisma.ClientesFornecedoresWhereInput {
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  return {
    contaId,
    ...(search ? { OR: [{ nome: { contains: search } }, { Uid: { contains: search } }] } : {}),
    ...(query.status ? { status: query.status as Status } : {}),
    ...(query.tipo === 'CLIENTE' || query.tipo === 'FORNECEDOR' ? { tipo: query.tipo } : {}),
  };
}
