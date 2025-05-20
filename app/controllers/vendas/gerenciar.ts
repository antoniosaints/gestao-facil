import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { vendaSchema } from "../../schemas/vendas";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";

export const getVenda = async (req: Request, res: Response) => {
  try {
    const venda = await prisma.vendas.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: {
        cliente: {
          select: {
            nome: true,
          },
        },
        ItensVendas: {
          include: {
            produto: {
              select: {
                id: true,
                nome: true,
              },
            },
          },
        },
      },
    });
    ResponseHandler(res, "Venda encontrada", venda);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const deleteVenda = async (req: Request, res: Response) => {
  try {
    const customData = getCustomRequest(req).customData;
    const resultado = await prisma.$transaction(async (tx) => {
      const items = await tx.itensVendas.findMany({
        where: {
          vendaId: Number(req.params.id),
        },
      });

      for (const item of items) {
        await tx.produto.update({
          where: {
            id: item.produtoId,
          },
          data: {
            estoque: {
              increment: item.quantidade,
            },
          },
        });
      }

      const venda = await tx.vendas.delete({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
      });

      return venda;
    });
    await enqueuePushNotification(
      {
        title: "Venda excluida",
        body: `A venda ${resultado.id} foi excluida.`,
      },
      customData.contaId
    );
    ResponseHandler(res, "Venda excluida com sucesso", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
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
        const produto = await tx.produto.findUniqueOrThrow({
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
        });
      }

      return venda;
    });

    await enqueuePushNotification(
      {
        title: "Opa! Nova venda.",
        body: `Uma nova venda no valor de R$ ${valorTotal.toFixed(
          2
        )} foi realizada`,
      },
      customData.contaId
    );

    return ResponseHandler(res, "Venda criada com sucesso", resultado);
  } catch (error: any) {
    return handleError(res, error);
  }
};
