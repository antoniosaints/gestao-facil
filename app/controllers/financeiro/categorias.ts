import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { Prisma } from "../../../generated";
import { isAccountOverdue } from "../../routers/web";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";

export const select2Categorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const search = (req.query.search as string) || null;
    const id = (req.query.id as string) || null;
    const customData = getCustomRequest(req).customData;

    // Caso o select2 mande apenas um ID (edição, por exemplo)
    if (id) {
      const responseUnique = await prisma.categoriaFinanceiro.findUnique({
        where: { id: Number(id), contaId: customData.contaId },
      });

      if (!responseUnique) {
        return res.json({ results: [] });
      }

      return res.json({
        results: [
          {
            id: responseUnique.id,
            label: `${responseUnique.id} - ${responseUnique.nome}`,
          },
        ],
      });
    }

    const where: Prisma.CategoriaFinanceiroWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.nome = { contains: search };
    }

    const categorias = await prisma.categoriaFinanceiro.findMany({
      where,
      take: 30,
      orderBy: [{ parentId: "asc" }, { id: "asc" }],
    });

    if (!categorias || categorias.length === 0) {
      return res.json({ results: [] });
    }

    const result: { id: number; label: string }[] = [];

    categorias.forEach((categoria) => {
      if (categoria.parentId === null) {
        // Categoria pai
        result.push({
          id: categoria.id,
          label: `${categoria.id} - ${categoria.nome}`,
        });

        // Filhos do pai
        categorias
          .filter((item) => item.parentId === categoria.id)
          .forEach((item) => {
            result.push({
              id: item.id,
              label: `${item.parentId}.${item.id} - ${item.nome}`,
            });
          });
      } else {
        // Evita duplicados
        if (!result.find((item) => item.id === categoria.id)) {
          result.push({
            id: categoria.id,
            label: `${categoria.parentId}.${categoria.id} - ${categoria.nome}`,
          });
        }
      }
    });

    return res.json({ results: result });
  } catch (error) {
    return res.json({ results: [] });
  }
};

export const listCategorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { contaId } = getCustomRequest(req).customData;

    const categorias = await prisma.categoriaFinanceiro.findMany({
      where: {
        contaId,
      },
      select: {
        id: true,
        nome: true,
        parentId: true,
      },
      orderBy: [{ parentId: "asc" }, { nome: "asc" }],
    });

    return ResponseHandler(res, "Categorias listadas com sucesso!", categorias, 200);
  } catch (error) {
    handleError(res, error);
  }
};

export const tableCategorias = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    if (await isAccountOverdue(req)) {
      return res.status(404).json({
        message: "Conta inativa ou bloqueada, verifique seu plano",
      });
    }

    const { contaId } = getCustomRequest(req).customData;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const search = (req.query.search as string) || "";
    const sortBy = (req.query.sortBy as string) || "nome";
    const order = req.query.order === "desc" ? "desc" : "asc";

    const where: Prisma.CategoriaFinanceiroWhereInput = {
      contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { Uid: { contains: search } },
        { Parent: { nome: { contains: search } } },
      ];
    }

    const orderBy: Prisma.CategoriaFinanceiroOrderByWithRelationInput[] = [];

    switch (sortBy) {
      case "id":
        orderBy.push({ id: order });
        break;
      case "Uid":
        orderBy.push({ Uid: order });
        break;
      case "parentId":
        orderBy.push({ parentId: order });
        break;
      default:
        orderBy.push({ nome: order });
        break;
    }

    orderBy.push({ id: "asc" });

    const total = await prisma.categoriaFinanceiro.count({ where });
    const data = await prisma.categoriaFinanceiro.findMany({
      where,
      select: {
        id: true,
        Uid: true,
        nome: true,
        parentId: true,
        Parent: {
          select: {
            id: true,
            nome: true,
          },
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return res.json({
      data,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    handleError(res, error);
  }
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
          Uid: gerarIdUnicoComMetaFinal("CAT"),
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
