import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { CategoriaFinanceiro } from "../../../generated";

function buildTree(
  items: CategoriaFinanceiro[],
  parentId: number | null = null
): CategoriaFinanceiro[] {
  return items
    .filter((item) => item.parentId === parentId)
    .map((item) => ({
      ...item,
      filhos: buildTree(items, item.id),
    }));
}

function buildList(
  items: CategoriaFinanceiro[],
  parentId: number | null = null,
  result: { id: number; text: string }[] = []
): { id: number; text: string }[] {
  const filhos = items
    .filter((item) => item.parentId === parentId)
    .sort((a, b) => a.id - b.id);

  for (const filho of filhos) {
    result.push({
      id: filho.id,
      text: `${filho.parentId ?? ""}.${filho.id} - ${filho.nome}`.replace(
        /^\./,
        ""
      ),
    });
    buildList(items, filho.id, result);
  }

  return result;
}

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
    take: 30,
    orderBy: [{ parentId: "asc" }, { id: "asc" }],
  });

  if (!categorias) {
    return res.json({ results: [] });
  }

  const result: { id: number; text: string }[] = [];

  categorias.forEach((categoria) => {
    if (categoria.parentId === null) {
      result.push({
        id: categoria.id,
        text: `${categoria.id} - ${categoria.nome}`,
      });
      // filhos diretos do pai
      categorias
        .filter((item) => item.parentId === categoria.id)
        .forEach((item) => {
          result.push({
            id: item.id,
            text: `${item.parentId}.${item.id} - ${item.nome}`,
          });
        });
    }else {
      if (!result.find((item) => item.id === categoria.id)) {
        result.push({
          id: categoria.id,
          text: `${categoria.parentId}.${categoria.id} - ${categoria.nome}`,
        });
      }
    }
  });

  res.json({ results: result });
};

export const saveCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id, nome, categoriaPai } = req.body;

    if (!nome) {
      return ResponseHandler(res, "Nome da categoria obrigatorio!", null, 400);
    }

    const { contaId } = getCustomRequest(req).customData;

    if (id) {
      await prisma.categoriaFinanceiro.update({
        where: {
          id: Number(id),
          contaId,
        },
        data: {
          nome,
          parentId: categoriaPai ? Number(categoriaPai) : null,
        },
      });
    } else {
      await prisma.categoriaFinanceiro.create({
        data: {
          contaId,
          nome,
          parentId: categoriaPai ? Number(categoriaPai) : null,
        },
      });
    }

    return ResponseHandler(res, "Categoria salva com sucesso!", null, 200);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteCategoria = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const { contaId } = getCustomRequest(req).customData;
    await prisma.categoriaFinanceiro.deleteMany({
      where: {
        id: Number(id),
        contaId,
      },
    });
    return ResponseHandler(res, "Categoria deletada com sucesso!", null, 200);
  } catch (error) {
    handleError(res, error);
  }
};
