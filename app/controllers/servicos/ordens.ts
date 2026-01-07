import Decimal from "decimal.js";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { prisma } from "../../utils/prisma";
import { addHours } from "date-fns";
import { Request, Response } from "express";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { z } from "zod";
import { saveOrdemServicoSchema } from "../../schemas/ordemservico";
import { ItensOrdensServico } from "../../../generated";
import { hasPermission } from "../../helpers/userPermission";

export const addNovaMensagemOrdem = async (req: Request, res: Response): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      throw new Error("Id nao encontrado");
    }
    if (!req.body.mensagem) {
      throw new Error("Mensagem não encontrada");
    }

    const resultado = await prisma.mensagensInteracoesOrdemServico.create({
      data: {
        ordemId: id,
        mensagem: req.body.mensagem,
        autorId: customData.userId,
        tipo: "MENSAGEM"
      },
    })

    return ResponseHandler(res, "Mensagem adicionada com sucesso", resultado);
  }catch (err: any) {
    handleError(res, err);
  }
}

export const updateVendaInternal = async (
  osId: number,
  data: z.infer<typeof saveOrdemServicoSchema>,
  customData: any
) => {
  return await prisma.$transaction(async (tx) => {
    const ordemEncontrada = await tx.ordensServico.findUnique({
      where: {
        id: osId,
        contaId: customData.contaId,
      },
      include: {
        ItensOrdensServico: true,
      },
    });

    if (!ordemEncontrada) {
      throw new Error("OS nao encontrada");
    }

    const itensOSOriginal = ordemEncontrada.ItensOrdensServico || [];

    // Remove itens e movimentações antigas
    await tx.itensOrdensServico.deleteMany({
      where: { ordemId: ordemEncontrada.id },
    });

    await Promise.all(
      itensOSOriginal.map(async (item) => {
        if (item.tipo === "PRODUTO") {
          await tx.movimentacoesEstoque.deleteMany({
            where: {
              ordemId: ordemEncontrada.id,
              produtoId: item.produtoId!,
            },
          });
          await tx.produto.update({
            where: {
              id: item.produtoId!,
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
    const itensOrdemServico = data.itens.map(
      (item): Omit<ItensOrdensServico, "id" | "createdAt" | "updatedAt"> => ({
        ordemId: ordemEncontrada.id,
        itemName: item.nome,
        tipo: item.tipo,
        produtoId: item.tipo === "PRODUTO" ? item.id : null,
        servicoId: item.tipo === "SERVICO" ? item.id : null,
        quantidade: item.quantidade,
        valor: new Decimal(item.valor),
      })
    );

    await tx.itensOrdensServico.createMany({
      data: itensOrdemServico,
    });

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    await Promise.all(
      itensOrdemServico.map(async (item) => {
        if (item.tipo === "PRODUTO") {
          await tx.produto.update({
            where: { id: item.produtoId!, contaId: customData.contaId },
            data: {
              estoque: { decrement: item.quantidade },
            },
          });
          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              ordemId: ordemEncontrada.id,
              produtoId: item.produtoId!,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: new Decimal(item.valor),
            },
          });
        }
      })
    );

    await tx.ordensServico.update({
      where: {
        id: ordemEncontrada.id,
        contaId: customData.contaId,
      },
      data: {
        clienteId: data.clienteId,
        descricao: data.descricao,
        descricaoCliente: data.descricaoCliente,
        operadorId: data.vendedorId,
        contaId: customData.contaId,
        data: addHours(data.data, 3),
        status: data.status,
        garantia: String(data.garantia),
        desconto: descontoTotal,
      },
    });

    // Retorna venda atualizada
    return await tx.ordensServico.findUnique({
      where: { id: ordemEncontrada.id, contaId: customData.contaId },
      include: { ItensOrdensServico: true },
    });
  });
};

export const saveOrdemServico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const query = req.query;
    const { data, success, error } = saveOrdemServicoSchema.safeParse(req.body);

    if (!success) {
      return handleError(res, error);
    }

    if (query.id) {
      const updated = await updateVendaInternal(
        Number(query.id),
        data,
        customData
      );
      return ResponseHandler(res, "OS atualizada com sucesso", updated, 200);
    }

    const descontoTotal = data.desconto
      ? new Decimal(data.desconto)
      : new Decimal(0);

    const resultado = await prisma.$transaction(async (tx) => {
      const ordemCriada = await tx.ordensServico.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("OS"),
          clienteId: data.clienteId,
          descricao: data.descricao,
          descricaoCliente: data.descricaoCliente,
          operadorId: data.vendedorId,
          contaId: customData.contaId,
          data: data.data,
          status: data.status,
          garantia: String(data.garantia),
          desconto: descontoTotal,
        },
      });

      const mensagem = await tx.mensagensInteracoesOrdemServico.create({
        data: {
          mensagem: data.descricao || "Abertura da ordem de serviço",
          autorId: customData.userId,
          ordemId: ordemCriada.id,
          data: data.data,
          tipo: "ABERTURA",
        },
      });
      for (const item of data.itens) {
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

          await tx.produto.update({
            where: { id: item.id, contaId: customData.contaId },
            data: {
              estoque: {
                decrement: item.quantidade,
              },
            },
          });

          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              ordemId: ordemCriada.id,
              produtoId: item.id,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: data.clienteId,
              contaId: customData.contaId,
              custo: new Decimal(item.valor),
            },
          });
        } else {
          const servico = await tx.servicos.findUniqueOrThrow({
            where: { id: item.id, contaId: customData.contaId },
          });

          if (!servico) {
            throw new Error(`Servico ${item.id} nao encontrado`);
          }
        }

        await tx.itensOrdensServico.create({
          data: {
            servicoId: item.tipo === "PRODUTO" ? null : item.id,
            produtoId: item.tipo === "SERVICO" ? null : item.id,
            quantidade: item.quantidade,
            valor: new Decimal(item.valor),
            ordemId: ordemCriada.id,
            itemName: item.nome,
            tipo: item.tipo,
          },
        });
      }

      return {
        ordemCriada,
        mensagem,
      };
    });

    await enqueuePushNotification(
      {
        title: "Nova OS aberta.",
        body: `Uma nova OS foi aberta no status ${data.status}.`,
      },
      customData.contaId
    );

    return ResponseHandler(res, "OS criada com sucesso", resultado);
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const deleteOrdemServico = async (
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
      const ordemBusca = await tx.ordensServico.findUniqueOrThrow({
        where: {
          id: Number(req.params.id),
          contaId: customData.contaId,
        },
        include: {
          ItensOrdensServico: true,
        },
      });

      if (ordemBusca.status === "FATURADA") {
        throw new Error("OS faturada não pode ser deletada!");
      }

      for (const item of ordemBusca.ItensOrdensServico) {
        if (item.tipo === "PRODUTO" && item.produtoId) {
          await tx.produto.update({
            where: {
              id: item.produtoId,
              contaId: customData.contaId,
            },
            data: {
              estoque: {
                increment: item.quantidade,
              },
            },
          });
        }
      }

      await tx.mensagensInteracoesOrdemServico.deleteMany({
        where: {
          ordemId: ordemBusca.id,
        },
      })

      const ordemServicoDeletada = await tx.ordensServico.delete({
        where: {
          id: ordemBusca.id,
          contaId: customData.contaId,
        },
      });

      return ordemServicoDeletada;
    });
    return ResponseHandler(res, "OS excluida com sucesso", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const buscarOrdens = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const resultado = await prisma.ordensServico.findMany({
      where: {
        contaId: customData.contaId,
      },
    })
    return ResponseHandler(res, "Ordens encontradas", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const buscarOrdem = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.params.id || isNaN(Number(req.params.id))) {
        throw new Error("Id nao encontrado");
    }
    const id = Number(req.params.id);
    const resultado = await prisma.ordensServico.findFirstOrThrow({
      where: {
        contaId: customData.contaId,
        id
      },
      include: {
        ItensOrdensServico: true
      }
    })
    return ResponseHandler(res, "Ordem encontrada", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
export const buscarOrdemDetalhe = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    if (!req.params.id || isNaN(Number(req.params.id))) {
        throw new Error("Id nao encontrado");
    }
    const id = Number(req.params.id);
    const resultado = await prisma.ordensServico.findFirstOrThrow({
      where: {
        contaId: customData.contaId,
        id
      },
      include: {
        ItensOrdensServico: true,
        Cliente: true,
        MensagensInteracoesOrdemServico: {
          include: {
            Autor: {
              select: {
                nome: true
              }
            }
          }
        },
        Operador: true,
      }
    })
    return ResponseHandler(res, "Ordem encontrada", resultado);
  } catch (err: any) {
    handleError(res, err);
  }
};
