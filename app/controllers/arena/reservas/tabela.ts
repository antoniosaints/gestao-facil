import { Request, Response } from "express";
import { prisma } from "../../../utils/prisma";
import { Prisma } from "../../../../generated";
import { getCustomRequest } from "../../../helpers/getCustomRequest";

export const ListagemReservas = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
    quadraId = undefined,
    inicio = undefined,
    fim = undefined,
  } = req.query as {
    search: string;
    limit: string;
    page: string;
    quadraId?: string;
    inicio: string;
    fim: string;
  };

  const start = inicio ? new Date(inicio as string) : undefined;
  const end = fim ? new Date(fim as string) : undefined;

  try {
    const model = prisma.arenaAgendamentos;

    const where: Prisma.ArenaAgendamentosWhereInput = {
      Quadra: { contaId: customData.contaId },
      startAt: {
        gte: start,
        lte: end,
      },
    };

    if (quadraId) {
      where.quadraId = Number(quadraId);
    }

    if (search) {
      where.OR = [
        { nomeCliente: { contains: search } },
        { Cliente: { nome: { contains: search } } },
        { observacoes: { contains: search } },
        { telefoneCliente: { contains: search } },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        include: { Quadra: true, Cliente: true },
        skip,
        take,
        orderBy: { nomeCliente: "asc" },
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
