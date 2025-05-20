import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { vendaSchema } from "../../schemas/vendas";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";

export const saveVenda = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { data, success, error } = vendaSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }

    const valorTotal = data.itens.reduce((total, item) => {
      return total.add(new Decimal(item.quantidade).mul(item.preco));
    }, new Decimal(0));

    const resultado = await prisma.$transaction(async (tx) => {
      const venda = await tx.vendas.create({
        data: {
          valor: valorTotal,
          clienteId: data.clienteId,
          vendedorId: data.vendedorId,
          contaId: customData.contaId,
          data: data.data,
          status: data.status,
          garantia: data.garantia,
        },
      });

      for (const item of data.itens) {
        const produto = await tx.produto.findUnique({
          where: { id: item.id },
        });

        if (!produto) {
          throw new Error(`Produto ${item.id} não encontrado`);
        }

        if (produto.estoque < item.quantidade) {
          throw new Error(
            `Produto ${produto.nome} não possui estoque suficiente (disponível: ${produto.estoque})`
          );
        }

        await tx.itensVendas.create({
          data: {
            vendaId: venda.id,
            produtoId: item.id,
            quantidade: item.quantidade,
            valor: new Decimal(item.preco),
          },
        });

        await tx.produto.update({
          where: { id: item.id },
          data: {
            estoque: {
              decrement: item.quantidade,
            },
          },
        });

        await tx.movimentacoesEstoque.create({
          data: {
            produtoId: item.id,
            quantidade: item.quantidade,
            status: "CONCLUIDO",
            tipo: "SAIDA",
            clienteFornecedor: data.clienteId,
            contaId: customData.contaId,
            custo: new Decimal(item.preco),
          },
        })
      }

      return venda;
    });

    return ResponseHandler(res, "Venda criada com sucesso", resultado);
  } catch (error: any) {
    return handleError(res, error);
  }
};
