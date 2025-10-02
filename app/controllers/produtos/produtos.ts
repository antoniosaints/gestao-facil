import { Request, Response } from "express";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import { ProdutoSchema, ReposicaoEstoqueSchema } from "../../schemas/produtos";
import { enqueuePushNotification } from "../../services/pushNotificationQueueService";
import { emailScheduleService } from "../../services/emailScheduleQueueService";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { mapperErrorSchema } from "../../mappers/schemasErros";
import { ResponseHandler } from "../../utils/response";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import Decimal from "decimal.js";

export const getProduto = async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const customData = getCustomRequest(req).customData;
  const produto = await prisma.produto.findUnique({
    where: {
      contaId: customData.contaId,
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
export const getProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const query = req.query;
  const produto = await prisma.produto.findMany({
    take: query?.limit ? Number(query?.limit) : 10,
    where: {
      contaId: customData.contaId,
      ...(query?.search
        ? {
            OR: [
              {
                nome: {
                  contains: query?.search as string,
                },
              },
              {
                codigo: {
                  contains: query?.search as string,
                },
              },
            ],
          }
        : {}),
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
        contaId: customData.contaId,
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
          contaId: customData.contaId,
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
          Uid: gerarIdUnicoComMetaFinal("PRO"),
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
    return res.sendStatus(500).json({
      message: "Erro ao salvar produto",
      data: error,
    });
  }
};

export const getResumoProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const { produtoId } = req.params;
  const customData = getCustomRequest(req).customData;

  if (!produtoId) {
    return ResponseHandler(res, "produtoId não informado", null, 404);
  }

  try {
    const id = Number(produtoId);

    const produto = await prisma.produto.findUnique({
      where: { id, contaId: customData.contaId },
      select: { preco: true, estoque: true },
    });

    if (!produto) {
      return ResponseHandler(res, "Produto nao encontrado", null, 404);
    }

    const movimentacoes = await prisma.movimentacoesEstoque.findMany({
      where: { produtoId: id, contaId: customData.contaId },
    });

    let totalGasto = new Decimal(0);
    let totalGanho = new Decimal(0);
    let totalEntradas = 0;
    let totalSaidas = 0;
    const valorProduto = new Decimal(produto.preco);

    for (const mov of movimentacoes) {
      const quantidade = new Decimal(mov.quantidade);
      const custo = new Decimal(mov.custo);
      const desconto = new Decimal(mov.desconto || 0);

      if (mov.tipo === "ENTRADA") {
        totalGasto = totalGasto.plus(quantidade.times(custo).minus(desconto));
        totalEntradas += mov.quantidade;
      } else if (mov.tipo === "SAIDA") {
        totalGanho = totalGanho.plus(custo.times(quantidade).minus(desconto));
        totalSaidas += mov.quantidade;
      }
    }

    // cálculos extras
    const ticketMedio =
      totalSaidas > 0 ? totalGanho.div(totalSaidas) : new Decimal(0);
    const estoqueAtual = totalEntradas - totalSaidas;
    const custoMedio =
      totalEntradas > 0 ? totalGasto.div(totalEntradas) : new Decimal(0);
    const valorEstoque = valorProduto.times(produto.estoque);
    const margemLucro =
      custoMedio.gt(0) && ticketMedio.gt(0)
        ? ticketMedio.minus(custoMedio).div(ticketMedio).times(100)
        : new Decimal(0);

    return res.json({
      produtoId: id,
      totalGasto: totalGasto.toFixed(2),
      lucroLiquido: totalGanho.minus(totalGasto).toFixed(2),
      ticketMedio: ticketMedio.toFixed(2),
      totalEntradas,
      totalSaidas,
      estoqueAtual,
      custoMedio: custoMedio.toFixed(2),
      valorEstoque: valorEstoque.toFixed(2),
      margemLucro: margemLucro.toFixed(2) + "%",
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const reposicaoProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const { data, error, success } = ReposicaoEstoqueSchema.safeParse(req.body);
  if (!success) {
    return handleError(res, error);
  }
  try {
    const entrada = await prisma.$transaction(async (tx) => {
      const produtoExistente = await tx.produto.findFirst({
        where: {
          contaId: customData.contaId,
          id: data.produtoId,
          entradas: true,
        },
      });

      if (!produtoExistente) {
        throw new Error(
          "Produto não permite entradas de estoque, altere isso antes de continuar."
        );
      }

      await tx.produto.update({
        where: { id: data.produtoId, contaId: customData.contaId },
        data: { estoque: { increment: data.quantidade } },
      });

      const movimentacao = await tx.movimentacoesEstoque.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("MOV"),
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
        include: { Produto: true },
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
