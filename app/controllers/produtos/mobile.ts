import { Request, Response } from "express";
import { Prisma } from "../../../generated";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";

export const ListagemMobileProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const {
    search = undefined,
    limit = "10",
    page = "1",
  } = req.query as { search: string; limit: string; page: string };

  try {
    const where: Prisma.ProdutoBaseWhereInput = { contaId: customData.contaId };
    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
        { Categoria: { nome: { contains: search } } },
        {
          variantes: {
            some: {
              OR: [
                { nomeVariante: { contains: search } },
                { codigo: { contains: search } },
              ],
            },
          },
        },
      ];
    }

    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    const [data, total] = await Promise.all([
      prisma.produtoBase.findMany({
        where,
        skip,
        take,
        orderBy: { nome: "asc" },
        include: {
          Categoria: true,
          variantes: {
            orderBy: [{ ehPadrao: "desc" }, { id: "asc" }],
          },
        },
      }),
      prisma.produtoBase.count({ where }),
    ]);

    const totalPages = Math.ceil(total / take);

    res.json({
      data: data.map((base) => {
        const variantePadrao =
          base.variantes.find((item) => item.ehPadrao) ?? base.variantes[0] ?? null;
        return {
          id: base.id,
          Uid: base.Uid,
          nome: base.nome,
          descricao: base.descricao,
          status: base.status,
          categoria: base.Categoria?.nome ?? null,
          estoqueTotal: base.variantes.reduce((acc, item) => acc + item.estoque, 0),
          totalVariantes: base.variantes.length,
          preco: variantePadrao?.preco ?? 0,
          codigo: variantePadrao?.codigo ?? null,
          unidade: variantePadrao?.unidade ?? null,
          variantePadraoId: variantePadrao?.id ?? null,
        };
      }),
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
