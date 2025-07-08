import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { ProdutoSchema, ReposicaoEstoqueSchema } from "../../schemas/produtos";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { emailScheduleService } from "../../services/emailScheduleQueueService";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { mapperErrorSchema } from "../../mappers/schemasErros";
import { ResponseHandler } from "../../utils/response";

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
export const deleteProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
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
    await emailScheduleService({
      to: "costaantonio883@gmail.com",
      subject: "Produto deletado",
      text: `O produto ${produto.nome} foi deletado.`,
    });
    await enqueuePushNotification(
      {
        title: "Produto deletado",
        body: `O produto ${produto.nome} foi deletado.`,
      },
      customData.contaId
    );

    return ResponseHandler(res, "Produto deletado com sucesso", produto);
  } catch (error) {
    handleError(res, error);
  }
};
export const saveProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { data, error, success } = ProdutoSchema.safeParse(req.body);
    const customData = getCustomRequest(req).customData;
    if (!success) {
      return ResponseHandler(
        res,
        "Dados inválidos",
        mapperErrorSchema(error),
        400
      );
    }
    if (data.id) {
      const produto = await prisma.produto.update({
        where: {
          id: data.id,
        },
        data: {
          nome: data.nome,
          descricao: data.descricao,
          minimo: data.minimo,
          precoCompra: data.precoCompra,
          unidade: data.unidade,
          codigo: data.codigo,
          preco: data.preco,
          entradas: data.entradas,
          saidas: data.saidas,
        },
      });

      await enqueuePushNotification(
        {
          title: "Atualização de produto",
          body: `O produto ${produto.nome} foi atualizado, Qtd: ${produto.estoque}.`,
        },
        customData.contaId
      );
    } else {
      await prisma.produto.create({
        data: {
          contaId: customData.contaId,
          estoque: data.estoque,
          nome: data.nome,
          preco: data.preco,
          descricao: data.descricao,
          precoCompra: data.precoCompra,
          unidade: data.unidade,
          codigo: data.codigo,
          minimo: data.minimo,
          entradas: data.entradas,
          saidas: data.saidas,
        },
      });
      await enqueuePushNotification(
        {
          title: "Cadastro de produto",
          body: `O produto ${data.nome} foi cadastrado no sistema, Qtd: ${data.estoque}.`,
        },
        customData.contaId
      );
    }
    return ResponseHandler(res, "Produto salvo com sucesso", data, 201);
  } catch (error) {
    handleError(res, error);
  }
};
export const reposicaoProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { data, error, success } = ReposicaoEstoqueSchema.safeParse(req.body);
  const customData = getCustomRequest(req).customData;
  if (!success) {
    return res.status(400).json({
      message: "Dados inválidos",
      data: mapperErrorSchema(error),
    });
  }
  try {
    const entrada = await prisma.$transaction(async (tx) => {
      const produtoExistente = await tx.produto.findFirst({
        where: {
          id: data.produtoId,
          entradas: true,
        },
      });

      if (!produtoExistente) {
        throw new Error("Produto não permite entradas de estoque, altere isso antes de continuar.");
      }

      await tx.produto.update({
        where: { id: data.produtoId },
        data: { estoque: { increment: data.quantidade } },
      });

      const movimentacao = await tx.movimentacoesEstoque.create({
        data: {
          produtoId: data.produtoId,
          tipo: "ENTRADA",
          status: "CONCLUIDO",
          quantidade: data.quantidade,
          custo: data.custo,
          contaId: customData.contaId,
          clienteFornecedor: data.fornecedor,
          notaFiscal: data.notaFiscal,
          desconto: data.desconto,
          frete: data.frete,
        },
        include: {
          Produto: {
            select: {
              nome: true,
              unidade: true,
            },
          },
        },
      });

      return movimentacao;
    });

    await enqueuePushNotification(
      {
        title: "Reposição de produto",
        body: `O produto ${entrada.Produto.nome} foi reposto com: ${data.quantidade} ${entrada.Produto.unidade}.`,
      },
      customData.contaId
    );

    ResponseHandler(res, "Reposição realizada com sucesso", entrada, 201);
  } catch (error) {
    handleError(res, error);
  }
};
