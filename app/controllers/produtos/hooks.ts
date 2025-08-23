import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { Prisma } from "../../../generated";

export const select2Produtos = async (req: Request, res: Response): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const produto = await prisma.produto.findUniqueOrThrow({
        where: { id: Number(id) },
      });
      return res.json({ results: { id: produto.id, label: produto.nome } });
    }

    const where: Prisma.ProdutoWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { codigo: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
      ];
    }

    const data = await prisma.produto.findMany({
      where,
      take: 20,
      orderBy: { nome: "asc" },
    });
    return res.json({
      results: data.map((produto) => ({ id: produto.id, label: produto.nome })),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};