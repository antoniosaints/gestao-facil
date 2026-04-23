import { Request, Response } from "express";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { efetivarVendaSchema, vendaSchema } from "../../schemas/vendas";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { enqueuePushNotificationByPreference } from "../../services/notifications/notificationPreferenceService";
import { addHours, eachMonthOfInterval, endOfDay, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { hasPermission } from "../../helpers/userPermission";
import { formatCurrency } from "../../utils/formatters";
import { z } from "zod";
import { sendUpdateTable } from "../../hooks/vendas/socket";
import { recalculateComandaStatus } from "./comandas";
import { cancelarCobrancaMercadoPago } from "../financeiro/cobrancas/managerCobranca";

function buildProdutoItemName(produto: {
  nome: string;
  nomeVariante?: string | null;
}) {
  return `${produto.nome} / ${produto.nomeVariante || "Padrão"}`;
}

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

    const {
      pagamento,
      dataPagamento,
      conta: contaId,
      categoria,
      cancelarCobrancaExterna,
    } = resultado;

    const transaction = await prisma.$transaction(async (tx) => {
      const venda = await tx.vendas.findUniqueOrThrow({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
        include: {
          CobrancasFinanceiras: true,
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

      await tx.cobrancasFinanceiras.updateMany({
        where: {
          vendaId: venda.id,
          status: "PENDENTE",
          gateway: "interno",
        },
        data: {
          status: "EFETIVADO",
        },
      });

      if (!resultado.lancamentoManual) {
        if (!categoria || !contaId) {
          throw new Error(
            "Conta e categoria sao obrigatorias quando o lancamento automatico estiver ativo."
          );
        }

        await tx.lancamentoFinanceiro.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("FIN"),
            contaId: venda.contaId,
            vendaId: venda.id,
            valorBruto: venda.valor.plus(venda.desconto || new Decimal(0)),
            valorTotal: venda.valor,
            desconto: venda.desconto,
            recorrente: false,
            dataLancamento: new Date(dataPagamento),
            descricao: `Venda ${venda.Uid}`,
            status: "PAGO",
            categoriaId: categoria,
            contasFinanceiroId: contaId,
            formaPagamento: pagamento,
            tipo: "RECEITA",
            parcelas: {
              create: {
                dataPagamento: new Date(dataPagamento),
                numero: 1,
                vencimento: new Date(dataPagamento),
                formaPagamento: pagamento,
                pago: true,
                Uid: gerarIdUnicoComMetaFinal("PAR"),
                valorPago: venda.valor,
                valor: venda.valor,
              },
            },
          },
        });
      }

      const cobrancasMercadoPagoPendentes = venda.CobrancasFinanceiras.filter(
        (cobranca) =>
          cobranca.gateway === "mercadopago" && cobranca.status === "PENDENTE"
      );

      return {
        ...venda,
        cobrancasMercadoPagoPendentes,
      };
    });

    let cancelamentosFalharam = 0;

    if (
      cancelarCobrancaExterna &&
      transaction.cobrancasMercadoPagoPendentes.length > 0
    ) {
      const parametros = await prisma.parametrosConta.findUniqueOrThrow({
        where: {
          contaId: customData.contaId,
        },
      });

      for (const cobranca of transaction.cobrancasMercadoPagoPendentes) {
        try {
          await cancelarCobrancaMercadoPago(parametros, cobranca);
        } catch (error) {
          console.log(error);
          cancelamentosFalharam += 1;
        }
      }
    }

    if (transaction.comandaId) {
      await recalculateComandaStatus(
        prisma,
        transaction.comandaId,
        transaction.contaId
      );
    }

    sendUpdateTable(transaction.contaId, { efetivada: true });
    const message =
      cancelamentosFalharam > 0
        ? "Venda efetivada, mas nem todas as cobrancas do Mercado Pago puderam ser canceladas."
        : "Venda efetivada";
    ResponseHandler(res, message, transaction);
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
    const venda = await prisma.$transaction(async (tx) => {
      const vendaAtual = await tx.vendas.findUniqueOrThrow({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
      });

      const vendaEstornada = await tx.vendas.update({
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

      await tx.cobrancasFinanceiras.updateMany({
        where: {
          vendaId: vendaAtual.id,
          status: "EFETIVADO",
        },
        data: {
          status: "ESTORNADO",
        },
      });

      return vendaEstornada;
    });

    if (venda.comandaId) {
      await recalculateComandaStatus(prisma, venda.comandaId, customData.contaId);
    }

    sendUpdateTable(customData.contaId, { efetivada: false });
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
        CobrancasFinanceiras: true,
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
      const isEfetivada = await tx.vendas.findUniqueOrThrow({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
      });

      if (isEfetivada.status === "FATURADO") {
        throw new Error("Venda efetivada, não pode ser deletada!");
      }

      if (isEfetivada.comandaId) {
        const cobrancasEfetivadas = await tx.cobrancasFinanceiras.count({
          where: {
            vendaId: isEfetivada.id,
            status: "EFETIVADO",
          },
        });

        if (cobrancasEfetivadas > 0) {
          throw new Error(
            "A venda da comanda possui cobranca efetivada e nao pode ser excluida."
          );
        }

        await tx.comandaItem.updateMany({
          where: {
            vendaId: isEfetivada.id,
          },
          data: {
            vendaId: null,
          },
        });

        await tx.cobrancasFinanceiras.deleteMany({
          where: {
            vendaId: isEfetivada.id,
          },
        });

        const venda = await tx.vendas.delete({
          where: {
            id: Number(req.params.id),
            contaId: customData.contaId,
          },
        });

        await recalculateComandaStatus(
          tx,
          isEfetivada.comandaId,
          customData.contaId
        );

        return venda;
      }

      if (isEfetivada.comandaId) {
        throw new Error("Vendas vinculadas a comandas não podem ser deletadas diretamente.");
      }

      const items = await tx.itensVendas.findMany({
        where: {
          vendaId: Number(req.params.id),
        },
      });

      for (const item of items) {
        if (item.produtoId === null) continue;
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

    const inicio = req.query.inicio
      ? startOfDay(new Date(String(req.query.inicio)))
      : startOfMonth(new Date());
    const fim = req.query.fim
      ? endOfDay(new Date(String(req.query.fim)))
      : endOfMonth(new Date());

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
      return res.status(400).json({ message: "Informe um período válido." });
    }

    const vendas = await prisma.vendas.findMany({
      where: {
        faturado: true,
        contaId: customData.contaId,
        vendedorId: permission ? undefined : customData.userId,
        data: {
          gte: inicio,
          lte: fim,
        },
      },
      select: {
        data: true,
        valor: true,
      },
      orderBy: {
        data: "asc",
      },
    });

    const labelsPeriodo = eachMonthOfInterval({ start: inicio, end: fim }).map((mes) =>
      format(mes, "MM/yyyy"),
    );

    const resumo = labelsPeriodo.reduce((acc, label) => {
      acc[label] = { total: new Decimal(0), quantidade: 0 };
      return acc;
    }, {} as Record<string, { total: Decimal; quantidade: number }>);

    vendas.forEach((venda) => {
      const mes = format(venda.data, "MM/yyyy");

      if (!resumo[mes]) {
        resumo[mes] = { total: new Decimal(0), quantidade: 0 };
      }

      resumo[mes].total = resumo[mes].total.plus(new Decimal(venda.valor));
      resumo[mes].quantidade += 1;
    });

    const valores = labelsPeriodo.map((mes) => resumo[mes]?.total.toNumber() || 0);
    const quantidades = labelsPeriodo.map((mes) => resumo[mes]?.quantidade || 0);

    const chartData = {
      labels: labelsPeriodo,
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
export const updateVendaInternal = async (
  vendaId: number,
  data: z.infer<typeof vendaSchema>,
  customData: any
) => {
  return await prisma.$transaction(async (tx) => {
    const venda = await tx.vendas.findUnique({
      where: {
        id: vendaId,
        contaId: customData.contaId,
      },
      include: {
        ItensVendas: true,
      },
    });

    if (!venda) {
      throw new Error("Venda nao encontrada");
    }

    const itensVendaOriginal = venda.ItensVendas || [];

    // Remove itens e movimentações antigas
    await tx.itensVendas.deleteMany({
      where: { vendaId: venda.id },
    });

    await Promise.all(
      itensVendaOriginal.map(async (item) => {
        if (item.produtoId) {
          await tx.movimentacoesEstoque.deleteMany({
            where: {
              vendaId: venda.id,
              produtoId: item.produtoId,
            },
          });
          await tx.produto.update({
            where: {
              id: item.produtoId,
              contaId: customData.contaId,
            },
            data: {
              estoque: { increment: item.quantidade },
            },
          });
        }
      })
    );

    // Novo conjunto de itens
    const itensVenda = data.itens.map((item) => ({
      vendaId: venda.id,
      itemName: item.nome,
      produtoId: item.tipo === "PRODUTO" ? item.id : null,
      servicoId: item.tipo === "SERVICO" ? item.id : null,
      quantidade: item.quantidade,
      valor: new Decimal(item.preco),
    }));

    await tx.itensVendas.createMany({
      data: itensVenda,
    });

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    await Promise.all(
      itensVenda.map(async (item) => {
        if (item.produtoId) {
          await tx.produto.update({
            where: { id: item.produtoId, contaId: customData.contaId },
            data: {
              estoque: { decrement: item.quantidade },
            },
          });
          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              vendaId: venda.id,
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: new Decimal(item.valor), // aqui assumindo que o valor = preço de venda
            },
          });
        }
      })
    );

    // Calcula totais
    const valorTotal = data.itens.reduce((total, item) => {
      return total.add(
        new Decimal(item.quantidade).mul(new Decimal(item.preco))
      );
    }, new Decimal(0));

    await tx.vendas.update({
      where: {
        id: venda.id,
        contaId: customData.contaId,
      },
      data: {
        valor: valorTotal.minus(descontoTotal),
        clienteId: data.clienteId,
        observacoes: data.observacoes,
        comandaId: data.comandaId,
        vendedorId: data.vendedorId || customData.userId,
        contaId: customData.contaId,
        data: addHours(data.data, 3),
        status: data.status,
        garantia: data.garantia,
        desconto: descontoTotal,
      },
    });

    // Retorna venda atualizada
    return await tx.vendas.findUnique({
      where: { id: venda.id, contaId: customData.contaId },
      include: { ItensVendas: true },
    });
  });
};

export const saveVenda = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const query = req.query;
    const { data, success, error } = vendaSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }

    if (query.id) {
      const updated = await updateVendaInternal(
        Number(query.id),
        data,
        customData
      );
      return ResponseHandler(res, "Venda atualizada com sucesso", updated, 200);
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
          comandaId: data.comandaId,
          data: addHours(data.data, 3),
          status: data.status,
          garantia: data.garantia,
          desconto: descontoTotal,
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
        let itemName = item.nome || "Item";
        if (item.tipo === "PRODUTO") {
          const produto = await tx.produto.findUniqueOrThrow({
            where: { id: item.id, contaId: customData.contaId },
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
        }
        if (item.tipo === "SERVICO") {
          const servico = await tx.servicos.findUniqueOrThrow({
            where: { id: item.id, contaId: customData.contaId },
          });
          if (!servico) {
            throw new Error(`Serviço ${item.id} não encontrado`);
          }
        }

        await tx.itensVendas.create({
          data: {
            vendaId: venda.id,
            itemName,
            produtoId: item.tipo === "PRODUTO" ? item.id : null,
            servicoId: item.tipo === "SERVICO" ? item.id : null,
            quantidade: item.quantidade,
            valor: new Decimal(item.preco),
          },
        });

        if (item.tipo === "PRODUTO") {
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

      }

      return venda;
    });

    await enqueuePushNotificationByPreference(
      "VENDA_CONCLUIDA",
      {
        title: "Opa! Nova venda.",
        body: `Uma nova venda no valor de ${formatCurrency(
          valorTotal.minus(descontoTotal)
        )} foi realizada`,
      },
      customData.contaId
    );

    return ResponseHandler(res, "Venda criada com sucesso", resultado);
  } catch (error: any) {
    return handleError(res, error);
  }
};
