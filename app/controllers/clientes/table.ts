import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";
import { Prisma, Status } from "../../../generated";

export const tableClientes = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;

  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";
  const { ...filters } = req.query;

  const where: Prisma.ClientesFornecedoresWhereInput = {
    contaId: customData.contaId,
  };
  if (search) {
    where.OR = [{ nome: { contains: search } }, { Uid: { contains: search } }];
  }

  if (filters.status) {
    where.status = filters.status as Status;
  }

  const total = await prisma.clientesFornecedores.count({ where });
  const data = await prisma.clientesFornecedores.findMany({
    where,
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
