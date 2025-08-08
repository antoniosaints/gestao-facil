import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { efetivarVendaSchema, vendaSchema } from "../../schemas/vendas";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { addHours, format } from "date-fns";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { hasPermission } from "../../helpers/userPermission";
import { formatCurrency } from "../../utils/formatters";

export const efetivarVenda = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;

    const {
      data: resultado,
      success,
      error,
    } = efetivarVendaSchema.safeParse(req.body);
    if (!success) {
      return handleError(res, error);
    }

    const { pagamento, dataPagamento, conta: contaId, categoria } = resultado;

    const transaction = await prisma.$transaction(async (tx) => {
      const venda = await tx.vendas.findUniqueOrThrow({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
      });

      if (venda.faturado) {
        throw Error("Venda ja efetivada");
      }

      await tx.vendas.update({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
          status: { not: "FATURADO" },
        },
        data: {
          status: "FATURADO",
          faturado: true,
          PagamentoVendas: {
            upsert: {
              create: {
                status: "EFETIVADO",
                data: new Date(dataPagamento),
                metodo: pagamento,
                valor: venda.valor,
              },
              update: {
                status: "EFETIVADO",
                data: new Date(dataPagamento),
                metodo: pagamento,
                valor: venda.valor,
              },
            },
          },
        },
      });

      await tx.lancamentoFinanceiro.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("FIN"),
          contaId: venda.contaId,
          vendaId: venda.id,
          valorBruto: venda.valor,
          valorTotal: venda.valor,
          desconto: venda.desconto,
          dataLancamento: new Date(dataPagamento),
          descricao: `Venda ${venda.Uid}`,
          status: "PAGO",
          categoriaId: categoria,
          contasFinanceiroId: contaId,
          formaPagamento: pagamento,
          tipo: "RECEITA"
        },
      })

      return venda;
    });

    ResponseHandler(res, "Venda efetivada", transaction);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const estornarVenda = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const venda = await prisma.vendas.update({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
        status: "FATURADO",
      },
      data: {
        status: "PENDENTE",
        faturado: false,
        PagamentoVendas: {
          delete: true,
        },
        LancamentoFinanceiro: {
          deleteMany: {
            vendaId: Number(req.params.id),
          },
        },
      },
    });
    ResponseHandler(res, "Venda estornada", venda);
  } catch (err: any) {
    handleError(res, err);
  }
};
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
        vendedor: {
          select: {
            nome: true,
          },
        },
        PagamentoVendas: true,
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
      },
      include: {
        PagamentoVendas: true,
      },
    });
    ResponseHandler(res, "Vendas encontradas", vendas);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const deleteVenda = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!(await hasPermission(customData, 3))) {
      return ResponseHandler(
        res,
        "Nível de permissão insuficiente!",
        null,
        403
      );
    }
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
    return ResponseHandler(res, "Venda excluida com sucesso", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const getResumoVendasMensalChart = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const permission = await hasPermission(customData, 3);
    const vendas = await prisma.vendas.findMany({
      where: {
        status: {
          in: ["FATURADO", "FINALIZADO"],
        },
        contaId: customData.contaId,
        vendedorId: permission ? undefined : customData.userId,
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
          backgroundColor: "#1ae010",
          borderColor: "#1ae010",
          yAxisID: "y1",
        },
        {
          label: "Qtd de Vendas",
          data: quantidades,
          backgroundColor: "#1037e3",
          borderColor: "#1037e3",
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

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    const resultado = await prisma.$transaction(async (tx) => {
      const venda = await tx.vendas.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("VEN"),
          valor: valorTotal.minus(descontoTotal),
          clienteId: data.clienteId,
          observacoes: data.observacoes,
          vendedorId: data.vendedorId || customData.userId,
          contaId: customData.contaId,
          data: addHours(data.data, 3),
          status: data.status,
          garantia: data.garantia,
          desconto: data.desconto ? new Decimal(data.desconto) : new Decimal(0),
          PagamentoVendas: {
            create: {
              valor: 0,
              metodo: "OUTRO",
              status: "PENDENTE",
            },
          },
        },
      });

      for (const item of data.itens) {
        const produto = await tx.produto.findUniqueOrThrow({
          where: { id: item.id },
        });

        if (!produto) {
          throw new Error(`Produto ${item.id} não encontrado`);
        }
        if (produto.saidas === false) {
          throw new Error(
            `Produto ${produto.nome} não permite saídas, altere isso antes de continuar`
          );
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
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            vendaId: venda.id,
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
        body: `Uma nova venda no valor de ${formatCurrency(valorTotal.minus(descontoTotal))} foi realizada`,
      },
      customData.contaId
    );

    return ResponseHandler(res, "Venda criada com sucesso", resultado);
  } catch (error: any) {
    return handleError(res, error);
  }
};
