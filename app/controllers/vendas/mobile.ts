import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { Prisma } from "../../../generated";

export const ListagemMobileVendas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string };

  try {
    const model = prisma.vendas;

    const where: Prisma.VendasWhereInput = { contaId: customData.contaId };
    if (search) {
      where.OR = [
        { Uid: { contains: search } },
        { cliente: { nome: { contains: search } } },
        { vendedor: { nome: { contains: search } } }
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take,
        orderBy: { data: "asc" },
      }),
      model.count({ where }),
    ]);

    const totalPages = Math.ceil(total / take);

    res.json({
      data,
      pagination: {
        total,
        page: Number(page),
        limit: take,
        totalPages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || "Erro ao buscar os dados" });
  }
};
