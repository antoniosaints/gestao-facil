import { Request, Response } from "express";
import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const select2Produtos = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const withStock = (req.query.withStock as string) || null;
    const baseOnly = String(req.query.baseOnly || "").toLowerCase() === "true";
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (baseOnly) {
      if (id) {
        const produtoBase = await prisma.produtoBase.findFirst({
          where: { id: Number(id), contaId: customData.contaId },
        });
        if (!produtoBase) {
          return res.json({ results: [] });
        }

        return res.json({
          results: [{ id: produtoBase.id, label: produtoBase.nome }],
        });
      }

      const bases = await prisma.produtoBase.findMany({
        where: {
          contaId: customData.contaId,
          ...(search
            ? {
                OR: [
                  { nome: { contains: search } },
                  { descricao: { contains: search } },
                  { Uid: { contains: search } },
                ],
              }
            : {}),
        },
        take: 20,
        orderBy: { nome: "asc" },
      });

      return res.json({
        results: bases.map((produtoBase) => ({
          id: produtoBase.id,
          label: produtoBase.nome,
        })),
      });
    }

    if (id) {
      const responseUnique = await prisma.produto.findFirst({
        where: { id: Number(id), contaId: customData.contaId },
        include: {
          ProdutoBase: true,
        },
      });
      if (!responseUnique) {
        return res.json({ results: [] });
      }

      const baseName = responseUnique.ProdutoBase?.nome || responseUnique.nome;
      const label = `${baseName} / ${responseUnique.nomeVariante}${
        withStock ? ` (${responseUnique.estoque} ${responseUnique.unidade || ""})` : ""
      }`;

      return res.json({
        results: [{ id: responseUnique.id, label: label.trim() }],
      });
    }

    const where: Prisma.ProdutoWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { nomeVariante: { contains: search } },
        { codigo: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
        {
          ProdutoBase: {
            nome: { contains: search },
          },
        },
      ];
    }

    const data = await prisma.produto.findMany({
      where,
      take: 20,
      orderBy: [{ nome: "asc" }, { nomeVariante: "asc" }],
      include: {
        ProdutoBase: true,
      },
    });
    return res.json({
      results: data.map((produto) => {
        const baseName = produto.ProdutoBase?.nome || produto.nome;
        return {
          id: produto.id,
          label: `${baseName} / ${produto.nomeVariante}${
            withStock ? ` (${produto.estoque} ${produto.unidade || ""})` : ""
          }`.trim(),
        };
      }),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};

export const select2CategoriasProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    if (id) {
      const categoria = await prisma.produtoCategoria.findFirst({
        where: {
          id: Number(id),
          contaId: customData.contaId,
        },
      });

      if (!categoria) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [{ id: categoria.id, label: categoria.nome }],
      });
    }

    const categorias = await prisma.produtoCategoria.findMany({
      where: {
        contaId: customData.contaId,
        ...(search
          ? {
              nome: {
                contains: search,
              },
            }
          : {}),
      },
      take: 20,
      orderBy: { nome: "asc" },
    });

    return res.json({
      results: categorias.map((categoria) => ({
        id: categoria.id,
        label: categoria.nome,
      })),
    });
  } catch (error) {
    return res.json({ results: [] });
  }
};
