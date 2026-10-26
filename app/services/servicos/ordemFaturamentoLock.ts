import type { Prisma } from "../../../generated";

export async function lockOrdemFaturamento(tx: Prisma.TransactionClient, contaId: number, ordemId: number) {
  // Lock before reading FATURADA or creating financial entries. The next
  // transaction observes the committed status and cannot invoice the OS twice.
  await tx.$queryRaw`SELECT id FROM OrdensServico WHERE id = ${ordemId} AND contaId = ${contaId} FOR UPDATE`;
}
