import dayjs from "dayjs";
import { prisma } from "../../utils/prisma";
import { Prisma, StatusPagamentoFinanceiro } from "../../../generated";
import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { resolveLancamentoStatusFromParcelas, sumParcelasFinanceiras } from "../../services/financeiro/parcelaFinanceiraPolicy";

export const atualizarStatusLancamentos = async (idConta: number) => {
  const hoje = dayjs().startOf("day").toDate();
  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: { contaId: idConta },
    include: {
      parcelas: true,
    },
  });

  for (const lancamento of lancamentos) {
    const novoStatus = resolveLancamentoStatusFromParcelas(lancamento.parcelas, hoje) as StatusPagamentoFinanceiro;
    const totalParcelas = sumParcelasFinanceiras(lancamento.parcelas);

    if (lancamento.status !== novoStatus || !new Prisma.Decimal(lancamento.valorTotal).equals(totalParcelas)) {
      await prisma.lancamentoFinanceiro.update({
        where: { id: lancamento.id },
        data: {
          status: novoStatus,
          valorTotal: totalParcelas,
          valorBruto: totalParcelas,
          recorrente: lancamento.parcelas.filter((parcela) => parcela.numero !== 0).length > 1,
        },
      });
    }
  }
};

export const select2ContasFinanceiras = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const responseUnique = await prisma.contasFinanceiro.findUniqueOrThrow({
        where: { id: Number(id), contaId: customData.contaId },
      });
      if (!responseUnique) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [{ id: responseUnique.id, label: responseUnique.nome }],
      });
    }

    const where: Prisma.ContasFinanceiroWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { Uid: { contains: search } },
      ];
    }

    const data = await prisma.contasFinanceiro.findMany({
      where,
      take: 20,
      orderBy: { nome: "asc" },
    });
    return res.json({
      results: data.map((produto) => ({ id: produto.id, label: produto.nome })),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};
