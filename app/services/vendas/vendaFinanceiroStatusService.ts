import type { Prisma, PrismaClient } from "../../../generated/client";

type DbClient = Prisma.TransactionClient | PrismaClient;

export async function syncVendasStatusByLancamentosFinanceiros(
  db: DbClient,
  contaId: number,
  lancamentoIds: Array<number | null | undefined>,
) {
  const ids = [...new Set(lancamentoIds.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  if (!ids.length) return [];

  const lancamentosAlterados = await db.lancamentoFinanceiro.findMany({
    where: {
      id: { in: ids },
      contaId,
      vendaId: { not: null },
    },
    select: {
      vendaId: true,
    },
  });

  const vendaIds = [...new Set(lancamentosAlterados.map((item) => item.vendaId).filter((id): id is number => Boolean(id)))];
  return syncVendasStatusByVendaIds(db, contaId, vendaIds);
}

export async function syncVendasStatusByVendaIds(
  db: DbClient,
  contaId: number,
  vendaIdsInput: Array<number | null | undefined>,
) {
  const vendaIds = [...new Set(vendaIdsInput.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  if (!vendaIds.length) return [];

  for (const vendaId of vendaIds) {
    const lancamentosVenda = await db.lancamentoFinanceiro.findMany({
      where: {
        contaId,
        vendaId,
      },
      select: {
        status: true,
        parcelas: {
          select: {
            pago: true,
          },
        },
      },
    });

    const financeiroRecebido = lancamentosVenda.length > 0 && lancamentosVenda.every((lancamento) => {
      if (!lancamento.parcelas.length) return lancamento.status === "PAGO";
      return lancamento.parcelas.every((parcela) => parcela.pago);
    });

    await db.vendas.updateMany({
      where: {
        id: vendaId,
        contaId,
        status: { not: "CANCELADO" },
      },
      data: {
        status: financeiroRecebido ? "FATURADO" : "PENDENTE",
        faturado: financeiroRecebido,
      },
    });

    await db.pagamentoVendas.updateMany({
      where: {
        vendaId,
      },
      data: {
        status: financeiroRecebido ? "EFETIVADO" : "PENDENTE",
      },
    });
  }

  return vendaIds;
}
