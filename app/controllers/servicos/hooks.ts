import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";

export const select2Servicos = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const responseUnique = await prisma.servicos.findUniqueOrThrow({
        where: { id: Number(id), contaId: customData.contaId },
      });

      if (!responseUnique) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [{ id: responseUnique.id, label: responseUnique.nome }],
      });
    }

    const where: Prisma.ServicosWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
      ];
    }

    const data = await prisma.servicos.findMany({
      where,
      take: 20,
      orderBy: { nome: "asc" },
    });
    return res.json({
      results: data.map((row) => {
        return {
          id: row.id,
          label: `${row.nome}`,
        }
      }),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};
