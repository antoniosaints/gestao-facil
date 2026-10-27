import type { Prisma } from '../../../generated';

export function buildServiceWhere(contaId: number, query: Record<string, unknown>): Prisma.ServicosWhereInput {
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  const status = String(query.status ?? '').toLowerCase();
  return {
    contaId,
    ...(search ? { OR: [{ nome: { contains: search } }, { Uid: { contains: search } }, { descricao: { contains: search } }] } : {}),
    ...(['true', '1', 'ativo'].includes(status) ? { status: true } : ['false', '0', 'inativo'].includes(status) ? { status: false } : {}),
  };
}
