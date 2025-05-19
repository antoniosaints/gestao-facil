import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { formatCurrency } from "../../utils/formatters";

export const select2Produtos = async (req: Request, res: Response): Promise<any> => {
  const search = (req.query.search as string) || '';

  const data = await prisma.produto.findMany({
    where: {
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

  const results = data.map((cliente) => ({
    id: cliente.id,
    text: `${cliente.nome} - Qtd: ${cliente.estoque} - ${formatCurrency(cliente.preco)}`,
  }));

  res.json({ results });
};
