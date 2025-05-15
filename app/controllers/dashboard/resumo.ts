import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { ResponseHandler } from "../../utils/response";

export const resumoDashboard = async (req: Request, res: Response): Promise<any> => {
  const { contaId, userId } = getCustomRequest(req).customData;
  try {
    const result = await prisma.$transaction(async (tsc) => {
      const vendasCount = await tsc.vendas.count({
        where: {
          OR: [{ contaId: contaId }],
        },
      });

      const produtos = await tsc.produto.findMany({
        select: {
          id: true,
          estoque: true,
          minimo: true,
          nome: true,
          preco: true,
        },
        where: {
          OR: [{ contaId: contaId }],
        },
      });

      const estoquesBaixos =
        produtos && produtos.length > 0
          ? produtos.filter((produto) => {
              return produto.estoque <= produto.minimo;
            })
          : [];

      const clientes = await tsc.clientesFornecedores.count({
        where: {
          OR: [{ contaId: contaId }],
        },
      });

      return {
        vendasCount,
        estoquesBaixos,
        clientes,
        produtos,
      };
    });

    return ResponseHandler(res, "Resumo", result);
  } catch (error) {
    handleError(res, error);
  }
};
