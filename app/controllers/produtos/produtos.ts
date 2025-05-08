import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { AddProdutoSchema } from "../../schemas/produtos";

export const getProduto = async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const produto = await prisma.produto.findUnique({
    where: {
      id: Number(id),
    },
  });
  if (!produto) {
    return res.status(404).json({
      message: "Produto não encontrado",
      data: null,
    });
  }
  return res.status(200).json({
    message: "Produto encontrado",
    data: produto,
  });
};
export const deleteProduto = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const produto = await prisma.produto.delete({
      where: {
        id: Number(id),
      },
    });
    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
        data: null,
      });
    }
    return res.status(200).json({
      message: "Produto deletado com sucesso",
      data: produto,
    });
  }catch (error) {
    handleError(res, error);
  }
};

export const saveProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const validated = AddProdutoSchema.safeParse(req.body);
    const data = validated.data;
    if (!validated.success) {
      return res.status(400).json({
        message: "Dados inválidos",
        data: validated.error.errors,
      });
    }
    if (data?.id) {
      await prisma.produto.update({
        where: {
          id: Number(data?.id),
        },
        data: {
          nome: data?.nome,
          descricao: data?.descricao,
          preco: Number(data?.preco),
          estoque: Number(data?.estoque),
        },
      });
    } else {
      await prisma.produto.create({
        data: {
          contaId: 7,
          estoque: Number(data?.estoque),
          nome: data?.nome!,
          preco: Number(data?.preco),
          minimo: 1,
        },
      });
    }

    return res.status(201).json({
      message: "Produto criado com sucesso",
      data: data,
    });
  } catch (error) {
    handleError(res, error);
  }
};
