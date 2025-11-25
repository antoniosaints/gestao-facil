import { Request, Response } from "express";
import { getCustomRequest } from "../../../helpers/getCustomRequest";
import { prisma } from "../../../utils/prisma";
import { Prisma } from "../../../../generated";

export const select2ArenaQuadras = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const responseUnique =
        await prisma.arenaQuadras.findUniqueOrThrow({
          where: { id: Number(id), contaId: customData.contaId },
        });

      if (!responseUnique) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [{ id: responseUnique.id, label: responseUnique.name }],
      });
    }

    const where: Prisma.ArenaQuadrasWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    const data = await prisma.arenaQuadras.findMany({
      where,
      take: 20,
      orderBy: { name: "asc" },
    });
    return res.json({
      results: data.map((row) => ({ id: row.id, label: row.name })),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};
