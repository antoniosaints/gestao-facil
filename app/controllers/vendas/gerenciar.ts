import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { vendaSchema } from "../../schemas/vendas";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { addHours, format } from "date-fns";

export const getVenda = async (req: Request, res: Response) => {
  try {
    const customData = getCustomRequest(req).customData;
    const venda = await prisma.vendas.findUniqueOrThrow({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
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
export const getVendas = async (req: Request, res: Response) => {
  try {
    const customData = getCustomRequest(req).customData;
    const vendas = await prisma.vendas.findMany({
      where: {
        contaId: customData.contaId,
      }
    });
    ResponseHandler(res, "Vendas encontradas", vendas);
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
export const getResumoVendasMensalChart = async (
  req: Request,
  res: Response
) => {
  try {
     const customData = getCustomRequest(req).customData;
    const vendas = await prisma.vendas.findMany({
      where: {
        status: {
          in: ["FATURADO", "FINALIZADO"],
        },
        contaId: customData.contaId,
      },
      select: {
        data: true,
        valor: true,
      },
    });

    // Estrutura com quantidade e valor
    const resumo: Record<string, { total: Decimal; quantidade: number }> = {};

    vendas.forEach((venda) => {
      const mes = format(venda.data, "MM/yyyy");

      if (!resumo[mes]) {
        resumo[mes] = { total: new Decimal(0), quantidade: 0 };
      }

      resumo[mes].total = resumo[mes].total.plus(new Decimal(venda.valor));
      resumo[mes].quantidade += 1;
    });

    const labels = Object.keys(resumo).sort();
    const valores = labels.map((mes) => resumo[mes].total.toNumber());
    const quantidades = labels.map((mes) => resumo[mes].quantidade);

    const chartData = {
      labels,
      datasets: [
        {
          label: "Valor Total (R$)",
          data: valores,
          backgroundColor: "rgba(75, 192, 192, 0.5)",
          borderColor: "rgba(75, 192, 192, 1)",
          yAxisID: "y1",
        },
        {
          label: "Quantidade de Vendas",
          data: quantidades,
          backgroundColor: "rgba(255, 159, 64, 0.5)",
          borderColor: "rgba(255, 159, 64, 1)",
          yAxisID: "y2",
        },
      ],
    };

    ResponseHandler(res, "Resumo mensal gerado com sucesso", chartData);
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
          vendedorId: data.vendedorId || customData.userId,
          contaId: customData.contaId,
          data: addHours(data.data, 4),
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
