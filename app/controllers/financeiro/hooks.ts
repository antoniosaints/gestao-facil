import dayjs from "dayjs";
import { StatusPagamentoFinanceiro } from "../../../generated";
import { prisma } from "../../utils/prisma";

export const atualizarStatusLancamentos = async (idConta: number) => {
  const hoje = dayjs().startOf("day").toDate();
  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: { contaId: idConta },
    include: {
      parcelas: true,
    },
  });

  for (const lancamento of lancamentos) {
    const totalParcelas = lancamento.parcelas.length;
    const parcelasPagas = lancamento.parcelas.filter((p) => p.pago).length;
    const parcelasVencidas = lancamento.parcelas.filter(
      (p) => !p.pago && dayjs(p.vencimento).isBefore(hoje)
    ).length;

    let novoStatus: StatusPagamentoFinanceiro;

    if (parcelasPagas === totalParcelas) {
      novoStatus = "PAGO";
    } else if (parcelasPagas > 0 && parcelasPagas < totalParcelas) {
      novoStatus = "PARCIAL";
    } else if (parcelasVencidas > 0) {
      novoStatus = "ATRASADO";
    } else {
      novoStatus = "PENDENTE";
    }

    if (lancamento.status !== novoStatus) {
      await prisma.lancamentoFinanceiro.update({
        where: { id: lancamento.id },
        data: { status: novoStatus },
      });
    }
  }
};
