import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";

export const select2Usuarios = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const responseUnique = await prisma.usuarios.findUniqueOrThrow({
        where: { id: Number(id), contaId: customData.contaId },
      });
      if (!responseUnique) {
        return res.json({ results: [] });
      }
      return res.json({
        results: [{ id: responseUnique.id, label: responseUnique.nome }],
      });
    }

    const where: Prisma.UsuariosWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const data = await prisma.usuarios.findMany({
      where,
      take: 20,
      orderBy: { nome: "asc" },
    });
    return res.json({
      results: data.map((row) => ({ id: row.id, label: row.nome })),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};
