import { startOfDay } from "date-fns";
import { prisma } from "../../utils/prisma";
import { calcularMovimentacoesRealizadasPorConta } from "./saldoContaFinanceiraPolicy";

export async function calcularSaldosAtuaisContas(
  contaId: number,
  contaFinanceiraIds: number[],
  referencia: Date = startOfDay(new Date()),
) {
  if (!contaFinanceiraIds.length) {
    return new Map();
  }

  const parcelas = await prisma.parcelaFinanceiro.findMany({
    where: {
      pago: true,
      ignorado: false,
      dataPagamento: {
        not: null,
        lte: referencia,
      },
      lancamento: {
        contaId,
        ignorado: false,
      },
      OR: [
        { contaFinanceira: { in: contaFinanceiraIds } },
        {
          contaFinanceira: null,
          lancamento: {
            contaId,
            contasFinanceiroId: { in: contaFinanceiraIds },
          },
        },
      ],
    },
    select: {
      contaFinanceira: true,
      valor: true,
      valorPago: true,
      pago: true,
      dataPagamento: true,
      lancamento: {
        select: {
          tipo: true,
          contasFinanceiroId: true,
        },
      },
    },
  });

  return calcularMovimentacoesRealizadasPorConta(parcelas, referencia);
}
