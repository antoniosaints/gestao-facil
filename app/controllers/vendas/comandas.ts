import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { generateCobrancaMercadoPago } from "../financeiro/mercadoPago/gerarCobranca";
import type { BodyCobranca } from "../financeiro/cobrancas";
import { Prisma, StatusComanda } from "../../../generated";

function buildProdutoItemName(produto: {
  nome: string;
  nomeVariante?: string | null;
}) {
  return `${produto.nome} / ${produto.nomeVariante || "Padrão"}`;
}

const comandaSchema = z.object({
  id: z.number().int().optional().nullable(),
  clienteId: z.number().int().optional().nullable(),
  clienteNome: z.string().trim().min(1, "Informe o nome da comanda."),
  observacao: z.string().optional().nullable(),
  reservaId: z.number().int().optional().nullable(),
});

const comandaItemSchema = z
  .object({
    tipo: z.enum(["PRODUTO", "SERVICO"]),
    itemId: z.number().int(),
    quantidade: z.number().int().min(1),
    valor: z.number().positive(),
  })
  .superRefine((data, ctx) => {
    if (!data.itemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe o item.",
        path: ["itemId"],
      });
    }
  });

const comandaCheckoutSchema = z.object({
  itemIds: z.array(z.number().int()).min(1, "Selecione ao menos um item."),
  valor: z.number().positive("Informe um valor válido."),
  gateway: z.enum(["interno", "mercadopago"]),
  tipoCobranca: z.enum(["PIX", "BOLETO", "LINK"]).optional().nullable(),
  vencimento: z.string().min(1),
  observacao: z.string().optional().nullable(),
  clienteId: z.number().int().optional().nullable(),
});

type PrismaExecutor = Prisma.TransactionClient | typeof prisma;

function parseStatusQuery(statusQuery?: string) {
  if (!statusQuery) {
    return [];
  }

  const validStatus: StatusComanda[] = [
    "ABERTA",
    "PENDENTE",
    "FECHADA",
    "CANCELADA",
  ];

  return statusQuery
    .split(",")
    .map((status) => status.trim())
    .filter((status): status is StatusComanda =>
      validStatus.includes(status as StatusComanda)
    );
}

export async function recalculateComandaStatus(
  executor: PrismaExecutor,
  comandaId: number,
  contaId: number
) {
  const comanda = await executor.comandaVenda.findUnique({
    where: {
      id: comandaId,
      contaId,
    },
    include: {
      itens: {
        where: {
          vendaId: null,
        },
      },
      vendas: {
        where: {
          status: {
            not: "CANCELADO",
          },
        },
        select: {
          id: true,
          faturado: true,
          status: true,
        },
      },
    },
  });

  if (!comanda || comanda.status === "CANCELADA") {
    return null;
  }

  let novoStatus: StatusComanda = "ABERTA";
  let fechamento: Date | null = null;

  if (comanda.itens.length === 0 && comanda.vendas.length > 0) {
    const todasPagas = comanda.vendas.every(
      (venda) => venda.faturado || venda.status === "FATURADO"
    );

    novoStatus = todasPagas ? "FECHADA" : "PENDENTE";
    fechamento = todasPagas ? new Date() : null;
  }

  await executor.comandaVenda.update({
    where: {
      id: comanda.id,
      contaId,
    },
    data: {
      status: novoStatus,
      fechamento,
    },
  });

  return novoStatus;
}

function parseDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data de vencimento inválida.");
  }
  return date;
}

async function buildComandaResumo(comandaId: number, contaId: number) {
  const data = await prisma.comandaVenda.findUniqueOrThrow({
    where: {
      id: comandaId,
      contaId,
    },
    include: {
      Cliente: true,
      itens: {
        where: {
          vendaId: null,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
      vendas: {
        orderBy: {
          createdAt: "desc",
        },
        include: {
          ComandaItens: {
            orderBy: {
              createdAt: "desc",
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
              servico: {
                select: {
                  id: true,
                  nome: true,
                },
              },
            },
          },
          PagamentoVendas: true,
          CobrancasFinanceiras: true,
        },
      },
    },
  });

  const itensAbertosTotal = data.itens.reduce((acc, item) => {
    return acc.plus(new Decimal(item.valor).mul(item.quantidade));
  }, new Decimal(0));

  const totalPendente = data.vendas
    .filter((venda) => !venda.faturado)
    .reduce((acc, venda) => acc.plus(venda.valor), new Decimal(0));

  const totalPago = data.vendas
    .filter((venda) => venda.faturado)
    .reduce((acc, venda) => acc.plus(venda.valor), new Decimal(0));

  return {
    ...data,
    resumo: {
      itensAbertos: data.itens.length,
      valorItensAbertos: itensAbertosTotal.toNumber(),
      valorPendente: totalPendente.toNumber(),
      valorPago: totalPago.toNumber(),
    },
  };
}

async function removeComandaItemInternal(
  tx: Prisma.TransactionClient,
  params: {
    comandaId: number;
    itemId: number;
    contaId: number;
  }
) {
  const item = await tx.comandaItem.findFirstOrThrow({
    where: {
      id: params.itemId,
      comandaId: params.comandaId,
      Comanda: {
        contaId: params.contaId,
      },
    },
  });

  if (item.vendaId) {
    const venda = await tx.vendas.findUniqueOrThrow({
      where: {
        id: item.vendaId,
        contaId: params.contaId,
      },
      include: {
        CobrancasFinanceiras: true,
      },
    });

    const possuiCobrancaExternaEfetivada = venda.CobrancasFinanceiras.some(
      (cobranca) =>
        cobranca.gateway !== "interno" && cobranca.status === "EFETIVADO"
    );

    if (possuiCobrancaExternaEfetivada) {
      throw new Error(
        "Esta venda possui cobranca externa efetivada e nao pode ser alterada por item."
      );
    }

    const possuiCobrancaExternaPendente = venda.CobrancasFinanceiras.some(
      (cobranca) =>
        cobranca.gateway !== "interno" && cobranca.status === "PENDENTE"
    );

    if (possuiCobrancaExternaPendente) {
      throw new Error(
        "Esta venda possui cobranca externa pendente. Exclua a venda completa para continuar."
      );
    }

    const vendaFoiEfetivada = venda.faturado || venda.status === "FATURADO";

    const vendaItem = await tx.itensVendas.findFirst({
      where: {
        vendaId: venda.id,
        produtoId: item.produtoId,
        servicoId: item.servicoId,
        quantidade: item.quantidade,
        valor: item.valor,
      },
      orderBy: {
        id: "desc",
      },
    });

    if (item.produtoId) {
      const movimentacao = await tx.movimentacoesEstoque.findFirst({
        where: {
          vendaId: venda.id,
          produtoId: item.produtoId,
          quantidade: item.quantidade,
          custo: item.valor,
        },
        orderBy: {
          id: "desc",
        },
      });

      if (movimentacao) {
        await tx.movimentacoesEstoque.delete({
          where: {
            id: movimentacao.id,
          },
        });
      }

      await tx.produto.update({
        where: {
          id: item.produtoId,
          contaId: params.contaId,
        },
        data: {
          estoque: {
            increment: item.quantidade,
          },
        },
      });
    }

    if (vendaItem) {
      await tx.itensVendas.delete({
        where: {
          id: vendaItem.id,
        },
      });
    }

    await tx.comandaItem.delete({
      where: {
        id: item.id,
      },
    });

    const itensRestantes = await tx.comandaItem.findMany({
      where: {
        vendaId: venda.id,
      },
    });

    if (itensRestantes.length === 0) {
      await tx.pagamentoVendas.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });

      await tx.lancamentoFinanceiro.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });

      await tx.cobrancasFinanceiras.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });

      await tx.vendas.delete({
        where: {
          id: venda.id,
          contaId: params.contaId,
        },
      });

      return {
        comandaId: params.comandaId,
      };
    }

    const subtotal = itensRestantes.reduce((acc, currentItem) => {
      return acc.plus(new Decimal(currentItem.valor).mul(currentItem.quantidade));
    }, new Decimal(0));

    const descontoAtual = new Decimal(venda.desconto || 0);
    const desconto =
      descontoAtual.greaterThan(subtotal) ? subtotal : descontoAtual;
    const valorFinal = subtotal.minus(desconto);

    if (vendaFoiEfetivada) {
      await tx.pagamentoVendas.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });

      await tx.lancamentoFinanceiro.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });

      await tx.cobrancasFinanceiras.deleteMany({
        where: {
          vendaId: venda.id,
        },
      });
    }

    await tx.vendas.update({
      where: {
        id: venda.id,
        contaId: params.contaId,
      },
      data: {
        valor: valorFinal,
        desconto,
        status: vendaFoiEfetivada ? "PENDENTE" : venda.status,
        faturado: false,
      },
    });

    if (!vendaFoiEfetivada) {
      await tx.pagamentoVendas.updateMany({
        where: {
          vendaId: venda.id,
          status: "PENDENTE",
        },
        data: {
          valor: valorFinal,
        },
      });

      await tx.cobrancasFinanceiras.updateMany({
        where: {
          vendaId: venda.id,
          status: "PENDENTE",
          gateway: "interno",
        },
        data: {
          valor: valorFinal,
        },
      });
    }

    return {
      comandaId: params.comandaId,
    };
  }

  if (item.produtoId) {
    await tx.produto.update({
      where: {
        id: item.produtoId,
        contaId: params.contaId,
      },
      data: {
        estoque: {
          increment: item.quantidade,
        },
      },
    });
  }

  await tx.comandaItem.delete({
    where: {
      id: item.id,
    },
  });

  return {
    comandaId: params.comandaId,
  };
}

export async function listComandas(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const search = (req.query.search as string) || "";
    const statusQuery = (req.query.status as string | undefined) || undefined;
    const statuses = parseStatusQuery(statusQuery);
    const requestedSortBy = (req.query.sortBy as string) || "abertura";
    const order = req.query.order === "asc" ? "asc" : "desc";
    const sortBy = ["id", "abertura", "fechamento", "clienteNome", "status"].includes(
      requestedSortBy
    )
      ? requestedSortBy
      : "abertura";

    const where: Prisma.ComandaVendaWhereInput = {
      contaId: customData.contaId,
    };

    if (statuses.length === 1) {
      where.status = statuses[0];
    } else if (statuses.length > 1) {
      where.status = {
        in: statuses,
      };
    }

    if (search) {
      where.OR = [
        { clienteNome: { contains: search } },
        { observacao: { contains: search } },
        { Cliente: { nome: { contains: search } } },
      ];
    }

    const total = await prisma.comandaVenda.count({ where });
    const data = await prisma.comandaVenda.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        Cliente: true,
        itens: {
          where: {
            vendaId: null,
          },
        },
        vendas: {
          include: {
            CobrancasFinanceiras: true,
          },
        },
      },
      orderBy: {
        [sortBy]: order,
      },
    });

    const rows = data.map((comanda) => {
      const valorItensAbertos = comanda.itens.reduce((acc, item) => {
        return acc.plus(new Decimal(item.valor).mul(item.quantidade));
      }, new Decimal(0));

      const valorPendente = comanda.vendas
        .filter((venda) => !venda.faturado)
        .reduce((acc, venda) => acc.plus(venda.valor), new Decimal(0));

      const valorPago = comanda.vendas
        .filter((venda) => venda.faturado)
        .reduce((acc, venda) => acc.plus(venda.valor), new Decimal(0));

      return {
        ...comanda,
        itensAbertos: comanda.itens.length,
        valorItensAbertos: valorItensAbertos.toNumber(),
        valorPendente: valorPendente.toNumber(),
        valorPago: valorPago.toNumber(),
      };
    });

    return res.json({
      data: rows,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    handleError(res, error);
  }
}

export async function getComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const data = await buildComandaResumo(
      Number(req.params.id),
      customData.contaId
    );
    return ResponseHandler(res, "Comanda encontrada com sucesso.", data);
  } catch (error) {
    handleError(res, error);
  }
}

export async function saveComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const { data, success, error } = comandaSchema.safeParse(req.body);
    if (!success) {
      return handleError(res, error);
    }

    const cliente =
      data.clienteId !== null && data.clienteId !== undefined
        ? await prisma.clientesFornecedores.findUnique({
            where: {
              id: data.clienteId,
              contaId: customData.contaId,
            },
            select: {
              id: true,
              nome: true,
            },
          })
        : null;

    const payload = {
      clienteNome: cliente?.nome || data.clienteNome,
      observacao: data.observacao || null,
      clienteId: cliente?.id || null,
      reservaId: data.reservaId || null,
    };

    const response = data.id
      ? await prisma.comandaVenda.update({
          where: {
            id: data.id,
            contaId: customData.contaId,
          },
          data: payload,
        })
      : await prisma.comandaVenda.create({
          data: {
            ...payload,
            contaId: customData.contaId,
            status: "ABERTA",
          },
        });

    return ResponseHandler(res, "Comanda salva com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function deleteComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const comandaId = Number(req.params.id);

    await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaVenda.findUniqueOrThrow({
        where: {
          id: comandaId,
          contaId: customData.contaId,
        },
        include: {
          itens: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      });

      for (const item of comanda.itens) {
        await removeComandaItemInternal(tx, {
          comandaId,
          itemId: item.id,
          contaId: customData.contaId,
        });
      }

      await tx.comandaVenda.delete({
        where: {
          id: comandaId,
          contaId: customData.contaId,
        },
      });
    });

    return ResponseHandler(res, "Comanda excluida com sucesso.", null);
  } catch (error) {
    handleError(res, error);
  }
}

export async function addItemComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const comandaId = Number(req.params.id);
    const { data, success, error } = comandaItemSchema.safeParse(req.body);
    if (!success) {
      return handleError(res, error);
    }

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaVenda.findUniqueOrThrow({
        where: {
          id: comandaId,
          contaId: customData.contaId,
        },
      });

      if (comanda.status !== "ABERTA") {
        throw new Error("Só é possível adicionar itens em comandas abertas.");
      }

      let itemName = "";
      let produtoId: number | null = null;
      let servicoId: number | null = null;

      if (data.tipo === "PRODUTO") {
        const produto = await tx.produto.findUniqueOrThrow({
          where: {
            id: data.itemId,
            contaId: customData.contaId,
          },
        });

        if (produto.saidas === false) {
          throw new Error(
            `Produto ${produto.nome} não permite saídas, ajuste isso antes de continuar.`
          );
        }

        if (produto.estoque < data.quantidade) {
          throw new Error(
            `Produto ${produto.nome} não possui estoque suficiente.`
          );
        }

        await tx.produto.update({
          where: {
            id: produto.id,
            contaId: customData.contaId,
          },
          data: {
            estoque: {
              decrement: data.quantidade,
            },
          },
        });

        itemName = buildProdutoItemName(produto);
        produtoId = produto.id;
      } else {
        const servico = await tx.servicos.findUniqueOrThrow({
          where: {
            id: data.itemId,
            contaId: customData.contaId,
          },
        });

        itemName = servico.nome;
        servicoId = servico.id;
      }

      return tx.comandaItem.create({
        data: {
          comandaId: comanda.id,
          itemName,
          tipo: data.tipo,
          produtoId,
          servicoId,
          quantidade: data.quantidade,
          valor: new Decimal(data.valor),
        },
      });
    });

    return ResponseHandler(res, "Item adicionado com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function removeItemComanda(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const comandaId = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    const transaction = await prisma.$transaction((tx) =>
      removeComandaItemInternal(tx, {
        comandaId,
        itemId,
        contaId: customData.contaId,
      })
    );

    await recalculateComandaStatus(prisma, transaction.comandaId, customData.contaId);

    return ResponseHandler(res, "Item removido com sucesso.", null);
  } catch (error) {
    handleError(res, error);
  }
}

export async function checkoutComanda(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const comandaId = Number(req.params.id);
    const { data, success, error } = comandaCheckoutSchema.safeParse(req.body);
    if (!success) {
      return handleError(res, error);
    }

    const vencimento = parseDate(data.vencimento);
    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaVenda.findUniqueOrThrow({
        where: {
          id: comandaId,
          contaId: customData.contaId,
        },
        include: {
          itens: {
            where: {
              id: {
                in: data.itemIds,
              },
              vendaId: null,
            },
          },
        },
      });

      if (comanda.itens.length !== data.itemIds.length) {
        throw new Error("Alguns itens selecionados não estão disponíveis.");
      }

      const subtotal = comanda.itens.reduce((acc, item) => {
        return acc.plus(new Decimal(item.valor).mul(item.quantidade));
      }, new Decimal(0));

      const valorCobrado = new Decimal(data.valor);
      const desconto = subtotal.minus(valorCobrado);

      const venda = await tx.vendas.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("VEN"),
          contaId: customData.contaId,
          clienteId: data.clienteId ?? comanda.clienteId ?? null,
          comandaId: comanda.id,
          data: new Date(),
          status: "PENDENTE",
          faturado: false,
          observacoes: data.observacao || `Cobrança gerada pela comanda #${comanda.id}`,
          vendedorId: customData.userId,
          garantia: 0,
          desconto: desconto,
          valor: valorCobrado,
          PagamentoVendas: {
            create: {
              valor: valorCobrado,
              metodo: "OUTRO",
              status: "PENDENTE",
            },
          },
        },
      });

      for (const item of comanda.itens) {
        await tx.itensVendas.create({
          data: {
            vendaId: venda.id,
            itemName: item.itemName,
            produtoId: item.produtoId,
            servicoId: item.servicoId,
            quantidade: item.quantidade,
            valor: item.valor,
          },
        });

        if (item.produtoId) {
          await tx.movimentacoesEstoque.create({
            data: {
              Uid: gerarIdUnicoComMetaFinal("MOV"),
              vendaId: venda.id,
              produtoId: item.produtoId,
              quantidade: item.quantidade,
              status: "CONCLUIDO",
              tipo: "SAIDA",
              clienteFornecedor: venda.clienteId,
              contaId: customData.contaId,
              custo: item.valor,
            },
          });
        }
      }

      await tx.comandaItem.updateMany({
        where: {
          id: {
            in: data.itemIds,
          },
        },
        data: {
          vendaId: venda.id,
        },
      });

      let paymentLink: string | null = null;

      if (data.gateway === "interno") {
        await tx.cobrancasFinanceiras.create({
          data: {
            contaId: customData.contaId,
            Uid: gerarIdUnicoComMetaFinal("COB"),
            idCobranca: gerarIdUnicoComMetaFinal("COB"),
            valor: valorCobrado,
            gateway: "interno",
            dataVencimento: vencimento,
            status: "PENDENTE",
            observacao: data.observacao || "Cobrança manual gerada pela comanda",
            vendaId: venda.id,
          },
        });
      } else {
        const parametros = await tx.parametrosConta.findUniqueOrThrow({
          where: {
            contaId: customData.contaId,
          },
        });

        const body: BodyCobranca = {
          type: data.tipoCobranca || "PIX",
          value: valorCobrado.toNumber(),
          gateway: "mercadopago",
          clienteId: data.clienteId ?? comanda.clienteId ?? undefined,
          vinculo: {
            id: venda.id,
            tipo: "venda",
          },
        };

        paymentLink =
          (await generateCobrancaMercadoPago(body, parametros, tx)).paymentLink || null;
      }

      await recalculateComandaStatus(tx, comanda.id, customData.contaId);

      return {
        vendaId: venda.id,
        paymentLink,
      };
    });

    return ResponseHandler(res, "Checkout da comanda realizado com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}
