import { Request, Response } from "express";
import { clampPageSize, sanitizeSort } from "../../utils/pagination";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { isAccountOverdue } from "../../routers/web";
import { buildPeopleWhere } from "./queryFilters";

export const tableClientes = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;

  if (await isAccountOverdue(req))
    return res.status(404).json({
      message: "Conta inativa ou bloqueada, verifique seu plano",
    });

  const page = parseInt(req.query.page as string) || 1;
  const pageSize = clampPageSize(req.query.pageSize);
  const sortBy = (req.query.sortBy as string) || "id";
  const order = req.query.order || "asc";
  const where = buildPeopleWhere(customData.contaId, req.query);

  const total = await prisma.clientesFornecedores.count({ where });
  const data = await prisma.clientesFornecedores.findMany({
    where,
    orderBy: sanitizeSort(sortBy, order),
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
