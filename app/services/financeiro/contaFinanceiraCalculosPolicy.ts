import type { Prisma } from "../../../generated";

type ParcelaComConta = {
  contaFinanceira: number | null;
  lancamento: { contasFinanceiroId: number | null };
};

export function contaFinanceiraEfetivaId(parcela: ParcelaComConta) {
  return parcela.contaFinanceira ?? parcela.lancamento.contasFinanceiroId;
}

export function parcelaDaContaFinanceira(contaFinanceiraId: number): Prisma.ParcelaFinanceiroWhereInput {
  return {
    OR: [
      { contaFinanceira: contaFinanceiraId },
      { contaFinanceira: null, lancamento: { contasFinanceiroId: contaFinanceiraId } },
    ],
  };
}

// A conta da parcela tem precedência. Parcelas sem conta em ambos os níveis
// continuam nos cálculos, assim como antes da introdução desta configuração.
export const parcelaDeContaContabilizada = {
  OR: [
    { ContaFinanceira: { is: { ignorarNosCalculos: false } } },
    {
      contaFinanceira: null,
      lancamento: {
        OR: [
          { contasFinanceiroId: null },
          { ContasFinanceiro: { is: { ignorarNosCalculos: false } } },
        ],
      },
    },
  ],
} satisfies Prisma.ParcelaFinanceiroWhereInput;

export function contaIgnoradaDaParcela(parcela: ParcelaComConta, contasIgnoradas: ReadonlySet<number>) {
  const id = contaFinanceiraEfetivaId(parcela);
  return id !== null && contasIgnoradas.has(id);
}
