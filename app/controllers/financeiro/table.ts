import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";

export const tableFinanceiro = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  if (await isAccountOverdue(req)) {
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });
  }

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "dataLancamento";
  const order = req.query.order || "asc";

  const where: Prisma.LancamentoFinanceiroWhereInput = {
    contaId: customData.contaId,
  };

  if (search) {
    where.OR = [
      { descricao: { contains: search } },
      { Uid: { contains: search } },
      { venda: { Uid: { contains: search } } },
    ];
  }

  const total = await prisma.lancamentoFinanceiro.count({ where });
  const data = await prisma.lancamentoFinanceiro.findMany({
    where,
    include: { parcelas: true },
    orderBy: { [sortBy]: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};
