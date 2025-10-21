import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { Prisma } from "../../../generated";

export const ListagemMobileCobrancas = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string };

  try {
    const model = prisma.cobrancasFinanceiras;

    const where: Prisma.CobrancasFinanceirasWhereInput = { contaId: customData.contaId };
    if (search) {
      where.OR = [
        { gateway: { contains: search } },
        { idCobranca: { contains: search } },
        { Uid: { contains: search } },
        { observacao: { contains: search } },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take,
        orderBy: { dataVencimento: "desc" },
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
