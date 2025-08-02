import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

export const select2Categorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  const search = (req.query.search as string) || "";
  const { contaId } = getCustomRequest(req).customData;
  const categorias = await prisma.categoriaFinanceiro.findMany({
    where: {
      contaId,
      nome: {
        contains: search,
      },
    },
    take: 10,
    orderBy: { nome: "asc" },
  });

  if (!categorias) {
    return res.json({ results: [] });
  }

  const results = categorias.map((row) => ({
    id: row.id,
    text: row.nome,
  }));

  res.json({ results });
};
