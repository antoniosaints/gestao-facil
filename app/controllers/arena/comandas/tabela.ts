import { Request, Response } from "express";
import { prisma } from "../../../utils/prisma";
import { Prisma } from "../../../../generated";
import { getCustomRequest } from "../../../helpers/getCustomRequest";

export const ListagemComandas = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string };

  try {
    const model = prisma.comandaVenda;

    const where: Prisma.ComandaVendaWhereInput = { contaId: customData.contaId };

    if (search) {
      where.OR = [
        { observacao: { contains: search } },
        { clienteNome: { contains: search } },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        include: {
          Cliente: true,
          vendas: true
        },
        skip,
        take,
        orderBy: { id: "asc" },
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
