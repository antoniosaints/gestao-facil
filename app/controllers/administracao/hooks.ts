import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const select2Usuarios = async (req: Request, res: Response): Promise<any> => {
  const search = (req.query.search as string) || '';
  const { contaId } = getCustomRequest(req).customData;
  const data = await prisma.usuarios.findMany({
    where: {
      contaId,
      nome: {
        contains: search,
      },
    },
    take: 10,
    orderBy: { nome: 'asc' },
  });

  if (!data) {
    return res.json({ results: [] });
  }

  const results = data.map((row) => ({
    id: row.id,
    text: row.nome,
  }));

  res.json({ results });
};
