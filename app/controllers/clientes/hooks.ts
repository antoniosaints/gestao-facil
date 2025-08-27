import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";

export const select2Clientes = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const responseUnique =
        await prisma.clientesFornecedores.findUniqueOrThrow({
          where: { id: Number(id), contaId: customData.contaId },
        });

      if (!responseUnique) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [{ id: responseUnique.id, label: responseUnique.nome }],
      });
    }

    const where: Prisma.ClientesFornecedoresWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { email: { contains: search } },
        { documento: { contains: search } },
        { Uid: { contains: search } },
      ];
    }

    const data = await prisma.clientesFornecedores.findMany({
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
