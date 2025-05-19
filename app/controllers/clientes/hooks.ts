import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";

export const select2Clientes = async (req: Request, res: Response): Promise<any> => {
  const search = (req.query.search as string) || '';

  const clientes = await prisma.clientesFornecedores.findMany({
    where: {
      nome: {
        contains: search,
      },
    },
    take: 10,
    orderBy: { nome: 'asc' },
  });

  if (!clientes) {
    return res.json({ results: [] });
  }

  const results = clientes.map((cliente) => ({
    id: cliente.id,
    text: cliente.nome,
  }));

  res.json({ results });
};
