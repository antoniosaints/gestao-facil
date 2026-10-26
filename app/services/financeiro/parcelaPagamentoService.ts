import type { Prisma } from "../../../generated";

// Atomic payment claim before creating any remaining balance. Both Normal and
// Fácil must pass here; a second concurrent request cannot split the debt twice.
export async function registrarPagamentoSePendente(tx: Prisma.TransactionClient, parcelaId: number, data: Prisma.ParcelaFinanceiroUpdateManyMutationInput) {
  const result = await tx.parcelaFinanceiro.updateMany({ where: { id: parcelaId, pago: false }, data });
  if (result.count !== 1) throw Object.assign(new Error("A parcela já foi paga em outra sessão. Recarregue os dados."), { status: 409, code: "payment_conflict" });
}
