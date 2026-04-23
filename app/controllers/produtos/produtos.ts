import { Request, Response } from "express";
import Decimal from "decimal.js";
import { Prisma, Status } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import {
  ProdutoCategoriaSchema,
  ProdutoSchema,
  ReposicaoEstoqueSchema,
} from "../../schemas/produtos";
import { emailScheduleService } from "../../services/emailScheduleQueueService";
import { enqueuePushNotificationByPreference } from "../../services/notifications/notificationPreferenceService";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { mapperErrorSchema } from "../../mappers/schemasErros";
import { ResponseHandler } from "../../utils/response";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { z } from "zod";

const produtoVarianteSchema = ProdutoSchema.partial({ nome: true }).extend({
  produtoBaseId: z.number({
    required_error: "produtoBaseId é obrigatório",
    invalid_type_error: "produtoBaseId deve ser um número",
  }),
});

const produtoBaseInclude = {
  Categoria: true,
  variantes: {
    orderBy: [{ ehPadrao: "desc" as const }, { id: "asc" as const }],
  },
} satisfies Prisma.ProdutoBaseInclude;

function buildProdutoBaseResponse(
  base: Prisma.ProdutoBaseGetPayload<{ include: typeof produtoBaseInclude }>
) {
  const variantePadrao =
    base.variantes.find((item) => item.ehPadrao) ?? base.variantes[0] ?? null;

  return {
    id: base.id,
    contaId: base.contaId,
    Uid: base.Uid,
    status: base.status,
    nome: base.nome,
    descricao: base.descricao,
    categoriaId: base.categoriaId,
    categoria: base.Categoria?.nome ?? null,
    Categoria: base.Categoria,
    ncm: base.ncm,
    cest: base.cest,
    cfop: base.cfop,
    origem: base.origem,
    aliquotaIcms: base.aliquotaIcms,
    aliquotaIpi: base.aliquotaIpi,
    aliquotaPis: base.aliquotaPis,
    aliquotaCofins: base.aliquotaCofins,
    codigoProduto: base.codigoProduto,
    issAliquota: base.issAliquota,
    variantes: base.variantes,
    totalVariantes: base.variantes.length,
    estoqueTotal: base.variantes.reduce((acc, item) => acc + item.estoque, 0),
    variantePadraoId: variantePadrao?.id ?? null,
    nomeVariante: variantePadrao?.nomeVariante ?? "Padrão",
    preco: variantePadrao?.preco ?? 0,
    precoCompra: variantePadrao?.precoCompra ?? null,
    entradas: variantePadrao?.entradas ?? true,
    saidas: variantePadrao?.saidas ?? true,
    unidade: variantePadrao?.unidade ?? null,
    estoque: variantePadrao?.estoque ?? 0,
    minimo: variantePadrao?.minimo ?? 0,
    codigo: variantePadrao?.codigo ?? null,
    controlaEstoque: variantePadrao?.controlaEstoque ?? false,
    producaoLocal: variantePadrao?.producaoLocal ?? false,
    mostrarNoPdv: variantePadrao?.mostrarNoPdv ?? true,
    materiaPrima: variantePadrao?.materiaPrima ?? false,
    custoMedioProducao: variantePadrao?.custoMedioProducao ?? null,
  };
}

async function syncVariantBaseFields(
  tx: Prisma.TransactionClient,
  params: {
    produtoBaseId: number;
    nome: string;
    descricao: string | null;
    status: Status;
    categoriaNome: string | null;
  }
) {
  await tx.produto.updateMany({
    where: {
      produtoBaseId: params.produtoBaseId,
    },
    data: {
      nome: params.nome,
      descricao: params.descricao,
      status: params.status,
      categoria: params.categoriaNome,
    },
  });
}

async function getCategoriaNome(
  tx: Prisma.TransactionClient,
  contaId: number,
  categoriaId?: number | null
) {
  if (!categoriaId) return null;
  const categoria = await tx.produtoCategoria.findFirst({
    where: { id: categoriaId, contaId },
    select: { nome: true },
  });
  return categoria?.nome ?? null;
}

async function getProdutoVarianteById(
  contaId: number,
  varianteId: number
) {
  return prisma.produto.findFirst({
    where: {
      id: varianteId,
      contaId,
    },
    include: {
      ProdutoBase: {
        include: {
          Categoria: true,
        },
      },
    },
  });
}

export const getProduto = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const produto = await prisma.produtoBase.findFirst({
      where: {
        contaId: customData.contaId,
        id: Number(id),
      },
      include: produtoBaseInclude,
    });

    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
        data: null,
      });
    }

    return res.status(200).json({
      message: "Produto encontrado",
      data: buildProdutoBaseResponse(produto),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getProdutos = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const query = req.query;
    const produtos = await prisma.produto.findMany({
      take: query?.limit ? Number(query?.limit) : 10,
      where: {
        contaId: customData.contaId,
        ...(String(query?.pdv).toLowerCase() === "true"
          ? {
              AND: [
                {
                  OR: [{ mostrarNoPdv: true }, { mostrarNoPdv: null }],
                },
                {
                  OR: [{ materiaPrima: false }, { materiaPrima: null }],
                },
              ],
            }
          : {}),
        ...(query?.search
          ? {
              OR: [
                {
                  nome: {
                    contains: query?.search as string,
                  },
                },
                {
                  nomeVariante: {
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
      include: {
        ProdutoBase: true,
      },
      orderBy: [{ nome: "asc" }, { nomeVariante: "asc" }],
    });

    return res.status(200).json({
      message: "Produtos encontrados",
      data: produtos.map((produto) => ({
        ...produto,
        label: `${produto.nome}${produto.nomeVariante ? ` / ${produto.nomeVariante}` : ""}`,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;

    const produto = await prisma.produtoBase.findFirst({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
      include: {
        variantes: true,
      },
    });

    if (!produto) {
      return res.status(404).json({
        message: "Produto não encontrado",
        data: null,
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const variante of produto.variantes) {
        await tx.produto.delete({
          where: {
            id: variante.id,
            contaId: customData.contaId,
          },
        });
      }

      await tx.produtoBase.delete({
        where: {
          id: produto.id,
        },
      });
    });

    await emailScheduleService({
      to: "costaantonio883@gmail.com",
      subject: "Produto deletado",
      text: `O produto ${produto.nome} foi deletado.`,
    });
    await enqueuePushNotificationByPreference(
      "PRODUTO_ALTERADO",
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
    const customData = getCustomRequest(req).customData;
    const parsedProduto = ProdutoSchema.safeParse(req.body);
    if (!parsedProduto.success) {
      return ResponseHandler(
        res,
        "Dados inválidos",
        mapperErrorSchema(parsedProduto.error),
        400
      );
    }
    const data = parsedProduto.data;

    if (data.id) {
      const produto = await prisma.$transaction(async (tx) => {
        const produtoBase = await tx.produtoBase.findFirst({
          where: {
            id: data.id,
            contaId: customData.contaId,
          },
          include: {
            variantes: {
              where: { ehPadrao: true },
              take: 1,
            },
          },
        });

        if (!produtoBase) {
          throw new Error("Produto não encontrado");
        }

        const categoriaNome = await getCategoriaNome(
          tx,
          customData.contaId,
          data.categoriaId
        );

        await tx.produtoBase.update({
          where: { id: produtoBase.id },
          data: {
            nome: data.nome,
            descricao: data.descricao ?? null,
            categoriaId: data.categoriaId ?? null,
          },
        });

        await syncVariantBaseFields(tx, {
          produtoBaseId: produtoBase.id,
          nome: data.nome,
          descricao: data.descricao ?? null,
          status: produtoBase.status,
          categoriaNome,
        });

        const variantePadrao = produtoBase.variantes[0];
        if (variantePadrao) {
          await tx.produto.update({
            where: {
              id: variantePadrao.id,
              contaId: customData.contaId,
            },
            data: {
              nomeVariante: data.nomeVariante || "Padrão",
              minimo: data.minimo,
              precoCompra: data.precoCompra,
              unidade: data.unidade,
              codigo: data.codigo,
              preco: data.preco,
              entradas: data.entradas,
              saidas: data.saidas,
              controlaEstoque: data.controlaEstoque,
              producaoLocal: data.producaoLocal,
              mostrarNoPdv: data.mostrarNoPdv,
              materiaPrima: data.materiaPrima,
              custoMedioProducao: data.custoMedioProducao,
            },
          });
        } else {
          await tx.produto.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("PRO"),
              contaId: customData.contaId,
              produtoBaseId: produtoBase.id,
              ehPadrao: true,
              nomeVariante: data.nomeVariante || "Padrão",
              estoque: data.estoque as number,
              nome: data.nome,
              preco: data.preco as number,
              descricao: data.descricao,
              precoCompra: data.precoCompra,
              unidade: data.unidade,
              codigo: data.codigo,
              minimo: data.minimo as number,
              entradas: data.entradas,
              saidas: data.saidas,
              controlaEstoque: data.controlaEstoque,
              producaoLocal: data.producaoLocal,
              mostrarNoPdv: data.mostrarNoPdv,
              materiaPrima: data.materiaPrima,
              custoMedioProducao: data.custoMedioProducao,
              categoria: categoriaNome,
            },
          });
        }

        return tx.produtoBase.findUniqueOrThrow({
          where: { id: produtoBase.id },
          include: produtoBaseInclude,
        });
      });

      await enqueuePushNotificationByPreference(
        "PRODUTO_ALTERADO",
        {
          title: "Atualização de produto",
          body: `O produto ${produto.nome} foi atualizado.`,
        },
        customData.contaId
      );

      return ResponseHandler(
        res,
        "Produto salvo com sucesso",
        buildProdutoBaseResponse(produto),
        200
      );
    }

    const produto = await prisma.$transaction(async (tx) => {
      const categoriaNome = await getCategoriaNome(
        tx,
        customData.contaId,
        data.categoriaId
      );

      const produtoBase = await tx.produtoBase.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PB"),
          contaId: customData.contaId,
          nome: data.nome,
          descricao: data.descricao,
          categoriaId: data.categoriaId ?? null,
        },
      });

      await tx.produto.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PRO"),
          contaId: customData.contaId,
          produtoBaseId: produtoBase.id,
          estoque: data.estoque as number,
          nome: data.nome,
          nomeVariante: data.nomeVariante || "Padrão",
          ehPadrao: true,
          preco: data.preco as number,
          descricao: data.descricao,
          precoCompra: data.precoCompra,
          unidade: data.unidade,
          codigo: data.codigo,
          minimo: data.minimo as number,
          entradas: data.entradas,
          saidas: data.saidas,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          categoria: categoriaNome,
        },
      });

      return tx.produtoBase.findUniqueOrThrow({
        where: { id: produtoBase.id },
        include: produtoBaseInclude,
      });
    });

    await enqueuePushNotificationByPreference(
      "PRODUTO_ALTERADO",
      {
        title: "Cadastro de produto",
        body: `O produto ${data.nome} foi cadastrado no sistema.`,
      },
      customData.contaId
    );

    return ResponseHandler(
      res,
      "Produto salvo com sucesso",
      buildProdutoBaseResponse(produto),
      201
    );
  } catch (error) {
    handleError(res, error);
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

    const produto = await prisma.produtoBase.findFirst({
      where: { id, contaId: customData.contaId },
      include: {
        variantes: {
          select: { id: true, preco: true, estoque: true },
        },
      },
    });

    if (!produto) {
      return ResponseHandler(res, "Produto nao encontrado", null, 404);
    }

    const idsVariantes = produto.variantes.map((item) => item.id);

    const movimentacoes = await prisma.movimentacoesEstoque.findMany({
      where: { produtoId: { in: idsVariantes }, contaId: customData.contaId },
    });

    let totalGasto = new Decimal(0);
    let totalGanho = new Decimal(0);
    let totalEntradas = 0;
    let totalSaidas = 0;
    const valorProduto = produto.variantes.reduce(
      (acc, item) => acc.plus(new Decimal(item.preco).times(item.estoque)),
      new Decimal(0)
    );

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

    const ticketMedio =
      totalSaidas > 0 ? totalGanho.div(totalSaidas) : new Decimal(0);
    const estoqueAtual = produto.variantes.reduce(
      (acc, item) => acc + item.estoque,
      0
    );
    const custoMedio =
      totalEntradas > 0 ? totalGasto.div(totalEntradas) : new Decimal(0);
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
      valorEstoque: valorProduto.toFixed(2),
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
  const parsedReposicao = ReposicaoEstoqueSchema.safeParse(req.body);
  if (!parsedReposicao.success) {
    return handleError(res, parsedReposicao.error);
  }
  const data = parsedReposicao.data;
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
          produtoId: data.produtoId as number,
          tipo: "ENTRADA",
          status: "CONCLUIDO",
          quantidade: data.quantidade || 0,
          custo: data.custo || 0,
          contaId: customData.contaId,
          clienteFornecedor: data.fornecedor,
          notaFiscal: data.notaFiscal,
          desconto: data.desconto,
          frete: data.frete,

        },
      });

      const produto = await tx.produto.findFirstOrThrow({
        where: {
          id: data.produtoId,
          contaId: customData.contaId,
        },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          unidade: true,
        },
      });

      return { movimentacao, produto };
    });

    await enqueuePushNotificationByPreference(
      "PRODUTO_ALTERADO",
      {
        title: "Reposição de produto",
        body: `A variante ${entrada.produto.nome} / ${entrada.produto.nomeVariante} foi reposta com: ${data.quantidade} ${entrada.produto.unidade}.`,
      },
      customData.contaId
    );

    return ResponseHandler(
      res,
      "Reposição realizada com sucesso",
      {
        ...entrada.movimentacao,
        Produto: entrada.produto,
      },
      201
    );
  } catch (error) {
    handleError(res, error);
  }
};

export const getProdutoVariante = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const variante = await getProdutoVarianteById(customData.contaId, Number(id));

    if (!variante) {
      return ResponseHandler(res, "Variante não encontrada", null, 404);
    }

    return ResponseHandler(res, "Variante encontrada", {
      ...variante,
      categoriaId: variante.ProdutoBase?.categoriaId ?? null,
      categoria: variante.ProdutoBase?.Categoria?.nome ?? null,
      produtoBaseNome: variante.ProdutoBase?.nome ?? variante.nome,
      label: `${variante.nome}${variante.nomeVariante ? ` / ${variante.nomeVariante}` : ""}`,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getVariantesProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const variantes = await prisma.produto.findMany({
      where: {
        contaId: customData.contaId,
        produtoBaseId: Number(id),
      },
      orderBy: [{ ehPadrao: "desc" }, { nomeVariante: "asc" }],
    });

    return ResponseHandler(res, "Variantes encontradas", variantes);
  } catch (error) {
    handleError(res, error);
  }
};

export const saveProdutoVariante = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const parsedVariante = produtoVarianteSchema.safeParse(req.body);
    if (!parsedVariante.success) {
      return ResponseHandler(
        res,
        "Dados inválidos",
        mapperErrorSchema(parsedVariante.error),
        400
      );
    }

    const data = parsedVariante.data;

    const variante = await prisma.$transaction(async (tx) => {
      const base = await tx.produtoBase.findFirst({
        where: {
          id: data.produtoBaseId,
          contaId: customData.contaId,
        },
        include: {
          Categoria: true,
        },
      });

      if (!base) {
        throw new Error("Produto base não encontrado");
      }

      const categoriaNome = base.Categoria?.nome ?? null;

      if (data.id) {
        return tx.produto.update({
          where: {
            id: data.id,
            contaId: customData.contaId,
          },
          data: {
            nome: base.nome,
            descricao: base.descricao,
            categoria: categoriaNome,
            nomeVariante: data.nomeVariante || "Padrão",
            minimo: data.minimo,
            precoCompra: data.precoCompra,
            unidade: data.unidade,
            codigo: data.codigo,
            preco: data.preco,
            entradas: data.entradas,
            saidas: data.saidas,
            controlaEstoque: data.controlaEstoque,
            producaoLocal: data.producaoLocal,
            mostrarNoPdv: data.mostrarNoPdv,
            materiaPrima: data.materiaPrima,
            custoMedioProducao: data.custoMedioProducao,
          },
        });
      }

      return tx.produto.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("PRO"),
          contaId: customData.contaId,
          produtoBaseId: base.id,
          nome: base.nome,
          descricao: base.descricao,
          status: base.status,
          categoria: categoriaNome,
          nomeVariante: data.nomeVariante || "Padrão",
          preco: data.preco || 0,
          precoCompra: data.precoCompra,
          entradas: data.entradas,
          saidas: data.saidas,
          unidade: data.unidade,
          estoque: data.estoque || 0,
          minimo: data.minimo || 0,
          codigo: data.codigo,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          ehPadrao: false,
        },
      });
    });

    return ResponseHandler(res, "Variante salva com sucesso", variante, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteProdutoVariante = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { id } = req.params;
    const customData = getCustomRequest(req).customData;
    const variante = await prisma.produto.findFirst({
      where: {
        id: Number(id),
        contaId: customData.contaId,
      },
    });

    if (!variante) {
      return ResponseHandler(res, "Variante não encontrada", null, 404);
    }

    if (variante.ehPadrao) {
      return ResponseHandler(
        res,
        "A variante padrão não pode ser excluída",
        null,
        400
      );
    }

    await prisma.produto.delete({
      where: {
        id: variante.id,
        contaId: customData.contaId,
      },
    });

    return ResponseHandler(res, "Variante excluída com sucesso", variante);
  } catch (error) {
    handleError(res, error);
  }
};

export const getResumoProdutoVariante = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  try {
    const variante = await prisma.produto.findFirst({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
      select: {
        id: true,
        preco: true,
        estoque: true,
      },
    });

    if (!variante) {
      return ResponseHandler(res, "Variante não encontrada", null, 404);
    }

    const movimentacoes = await prisma.movimentacoesEstoque.findMany({
      where: {
        produtoId: variante.id,
        contaId: customData.contaId,
      },
    });

    let totalGasto = new Decimal(0);
    let totalGanho = new Decimal(0);
    let totalEntradas = 0;
    let totalSaidas = 0;

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

    const ticketMedio =
      totalSaidas > 0 ? totalGanho.div(totalSaidas) : new Decimal(0);
    const custoMedio =
      totalEntradas > 0 ? totalGasto.div(totalEntradas) : new Decimal(0);
    const valorEstoque = new Decimal(variante.preco).times(variante.estoque);
    const margemLucro =
      custoMedio.gt(0) && ticketMedio.gt(0)
        ? ticketMedio.minus(custoMedio).div(ticketMedio).times(100)
        : new Decimal(0);

    return ResponseHandler(res, "Resumo encontrado", {
      produtoId: variante.id,
      totalGasto: totalGasto.toFixed(2),
      lucroLiquido: totalGanho.minus(totalGasto).toFixed(2),
      ticketMedio: ticketMedio.toFixed(2),
      totalEntradas,
      totalSaidas,
      estoqueAtual: variante.estoque,
      custoMedio: custoMedio.toFixed(2),
      valorEstoque: valorEstoque.toFixed(2),
      margemLucro: margemLucro.toFixed(2) + "%",
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getCategoriasProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 10;
    const search = (req.query.search as string) || "";
    const sortBy = (req.query.sortBy as string) || "nome";
    const order = (req.query.order as Prisma.SortOrder) || "asc";
    const where: Prisma.ProdutoCategoriaWhereInput = {
      contaId: customData.contaId,
      ...(search
        ? {
            OR: [{ nome: { contains: search } }, { Uid: { contains: search } }],
          }
        : {}),
    };
    const total = await prisma.produtoCategoria.count({ where });
    const categorias = await prisma.produtoCategoria.findMany({
      where,
      orderBy: { [sortBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return res.status(200).json({
      message: "Categorias encontradas",
      data: categorias,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const saveCategoriaProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const { data, success, error } = ProdutoCategoriaSchema.safeParse(req.body);
    if (!success) {
      return ResponseHandler(
        res,
        "Dados inválidos",
        mapperErrorSchema(error),
        400
      );
    }

    if (data.id) {
      const categoriaAnterior = await prisma.produtoCategoria.findFirst({
        where: {
          id: data.id,
          contaId: customData.contaId,
        },
      });

      if (!categoriaAnterior) {
        return ResponseHandler(res, "Categoria não encontrada", null, 404);
      }

      const categoria = await prisma.$transaction(async (tx) => {
        const categoriaAtualizada = await tx.produtoCategoria.update({
          where: { id: data.id },
          data: {
            nome: data.nome,
            status: data.status,
          },
        });

        await tx.produto.updateMany({
          where: {
            contaId: customData.contaId,
            categoria: categoriaAnterior.nome,
          },
          data: {
            categoria: categoriaAtualizada.nome,
          },
        });

        return categoriaAtualizada;
      });

      return ResponseHandler(res, "Categoria salva com sucesso", categoria);
    }

    const categoria = await prisma.produtoCategoria.create({
      data: {
        Uid: gerarIdUnicoComMetaFinal("PCAT"),
        contaId: customData.contaId,
        nome: data.nome,
        status: data.status,
      },
    });

    return ResponseHandler(res, "Categoria salva com sucesso", categoria, 201);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteCategoriaProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const categoria = await prisma.produtoCategoria.findFirst({
      where: {
        id: Number(req.params.id),
        contaId: customData.contaId,
      },
    });

    if (!categoria) {
      return ResponseHandler(res, "Categoria não encontrada", null, 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.produtoBase.updateMany({
        where: {
          categoriaId: categoria.id,
        },
        data: {
          categoriaId: null,
        },
      });

      await tx.produto.updateMany({
        where: {
          contaId: customData.contaId,
          categoria: categoria.nome,
        },
        data: {
          categoria: null,
        },
      });

      await tx.produtoCategoria.delete({
        where: {
          id: categoria.id,
        },
      });
    });

    return ResponseHandler(res, "Categoria excluída com sucesso", categoria);
  } catch (error) {
    handleError(res, error);
  }
};
