import { Request, Response } from "express";
import { prisma } from "../../../utils/prisma";
import { Prisma, StatusComanda } from "../../../../generated";
import { getCustomRequest } from "../../../helpers/getCustomRequest";

function parseStatusQuery(statusQuery?: string) {
  if (!statusQuery) {
    return [];
  }

  const validStatus: StatusComanda[] = [
    "ABERTA",
    "PENDENTE",
    "FECHADA",
    "CANCELADA",
  ];

  return statusQuery
    .split(",")
    .map((status) => status.trim())
    .filter((status): status is StatusComanda =>
      validStatus.includes(status as StatusComanda)
    );
}

export const ListagemComandas = async (req: Request, res: Response): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    status = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string, status: string | undefined };

  try {
    const model = prisma.comandaVenda;

    const where: Prisma.ComandaVendaWhereInput = { contaId: customData.contaId };

    if (search) {
      where.OR = [
        { observacao: { contains: search } },
        { clienteNome: { contains: search } },
      ];
    }

    const statuses = parseStatusQuery(status);

    if (statuses.length === 1) {
      where.status = statuses[0];
    } else if (statuses.length > 1) {
      where.status = {
        in: statuses,
      };
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
