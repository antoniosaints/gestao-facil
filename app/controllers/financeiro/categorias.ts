import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";

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

export const saveCategoria = async (req: Request, res: Response): Promise<any> => {
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
          contaId
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

export const deleteCategoria = async (req: Request, res: Response): Promise<any> => {
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