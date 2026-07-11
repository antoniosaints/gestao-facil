import { Request, Response } from "express";
import Decimal from "decimal.js";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { handleError } from "../../utils/handleError";
import { ResponseHandler } from "../../utils/response";
import { criarLancamentoFinanceiro } from "../../services/financeiro/lancamentoService";
import { sendFinanceiroUpdated } from "../../hooks/financeiro/socket";
import { checkLowStockAndNotify } from "../../services/notifications/lowStockNotificationService";
import { resolveRenderableImageSource } from "../../services/uploads/fileStorageService";
import {
  buildComandaPosFilename,
  buildComandaPosReceipt,
  buildComandaPdfFilename,
  calculateComandaReceiptHeight,
  calculateComandaTotal,
  calculateComandaPaymentTotal,
  canChangeComandaItems,
  canDeleteComanda,
  canConfigureComandas,
  canFaturarComanda,
  canFaturarComandaComFinanceiro,
  createComandaUid,
  COMANDA_RECEIPT_80MM_WIDTH_POINTS,
  formatComandaReceiptCurrency,
  formatComandaReceiptDateTime,
  getItemSubtotal,
  getProdutoStockDeltaForQuantityEdit,
  resolveComandaPaymentItemIds,
  getStatusAfterPayment,
  getUsuarioPermissionLevel,
  requiresStockReturnDecision,
  type ComandaOperacaoStatus,
} from "../../services/comandas/comandaPolicy";

type PrismaExecutor = Prisma.TransactionClient | typeof prisma;

const origemTipoSchema = z.enum(["PRODUTO", "SERVICO", "AVULSO"]);
const pagamentoMetodoSchema = z.enum([
  "PIX",
  "DINHEIRO",
  "CARTAO",
  "BOLETO",
  "PROMISSORIA",
]);

const comandaItemInputSchema = z.object({
  origemTipo: origemTipoSchema,
  origemId: z.union([z.string(), z.number()]).optional().nullable(),
  nome: z.string().trim().optional().nullable(),
  valorUnitario: z.coerce.number().positive("Informe um valor unitario valido."),
  quantidade: z.coerce.number().positive("Informe uma quantidade valida."),
});

const createComandaSchema = z.object({
  clienteId: z.coerce.number().int().positive().optional().nullable(),
  observacao: z.string().trim().optional().nullable(),
  itens: z
    .array(comandaItemInputSchema)
    .min(1, "Inclua ao menos um item na comanda."),
});

const addItensSchema = z.object({
  itens: z
    .array(comandaItemInputSchema)
    .min(1, "Inclua ao menos um item na comanda."),
});

const saveConfigSchema = z.object({
  contaFinanceiraIdPadrao: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
  categoriaFinanceiraIdPadrao: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .nullable(),
});

const removeItemSchema = z.object({
  devolverEstoque: z.boolean().optional(),
});

const updateItemSchema = comandaItemInputSchema.extend({
  devolverDiferencaEstoque: z.boolean().optional(),
});

const faturarSchema = z.object({
  metodo: pagamentoMetodoSchema,
  dataPagamento: z.string().min(1, "Informe a data de pagamento."),
  itemIds: z.array(z.coerce.number().int().positive()).optional(),
  lancarFinanceiro: z.boolean().default(false),
  contaFinanceiraId: z.coerce.number().int().positive().optional().nullable(),
  categoriaFinanceiraId: z.coerce.number().int().positive().optional().nullable(),
});

const cancelarSchema = z.object({
  devolverEstoque: z.boolean().optional(),
  observacao: z.string().trim().optional().nullable(),
});

const deleteComandaSchema = z.object({
  devolverEstoque: z.boolean().optional(),
});

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Informe uma data valida.");
  }
  return date;
}

function parseStatusQuery(statusQuery?: string) {
  if (!statusQuery || statusQuery === "TODOS") return [];
  const validStatus: ComandaOperacaoStatus[] = [
    "ABERTA",
    "PENDENTE",
    "FATURADA",
    "CANCELADA",
  ];

  return statusQuery
    .split(",")
    .map((status) => status.trim())
    .filter((status): status is ComandaOperacaoStatus =>
      validStatus.includes(status as ComandaOperacaoStatus)
    );
}

function normalizePositiveNumber(value: Decimal.Value, message: string) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new Error(message);
  }
  return decimal;
}

function mapMetodoFinanceiro(metodo: z.infer<typeof pagamentoMetodoSchema>) {
  if (metodo === "CARTAO") return "CREDITO" as const;
  if (metodo === "PROMISSORIA") return "BOLETO" as const;
  return metodo;
}

async function getPermissionLevel(contaId: number, userId: number) {
  const usuario = await prisma.usuarios.findFirstOrThrow({
    where: { id: userId, contaId },
    select: { permissao: true, superAdmin: true },
  });
  return getUsuarioPermissionLevel(usuario);
}

function assertPermission(
  allowed: boolean,
  message = "Voce nao tem permissao para realizar esta operacao."
) {
  if (!allowed) throw new Error(message);
}

async function createUniqueComandaUid(
  tx: Prisma.TransactionClient,
  contaId: number
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const Uid = createComandaUid();
    const exists = await tx.comandaOperacao.findFirst({
      where: { contaId, Uid },
      select: { id: true },
    });
    if (!exists) return Uid;
  }
  throw new Error("Nao foi possivel gerar um numero unico para a comanda.");
}

async function addHistorico(
  tx: Prisma.TransactionClient,
  params: {
    comandaId: number;
    evento: string;
    usuarioId: number;
    payload?: unknown;
  }
) {
  await tx.comandaOperacaoHistorico.create({
    data: {
      comandaId: params.comandaId,
      evento: params.evento,
      usuarioId: params.usuarioId,
      payloadJson: params.payload ? JSON.stringify(params.payload) : null,
    },
  });
}

async function assertComandaAberta(
  executor: PrismaExecutor,
  comandaId: number,
  contaId: number
) {
  const comanda = await executor.comandaOperacao.findFirstOrThrow({
    where: { id: comandaId, contaId },
    include: { itens: true },
  });

  if (!canChangeComandaItems(comanda.status)) {
    throw new Error("So e possivel alterar itens em comandas abertas.");
  }

  return comanda;
}

async function recalculateComandaTotal(
  tx: Prisma.TransactionClient,
  comandaId: number
) {
  const itens = await tx.comandaOperacaoItem.findMany({
    where: { comandaId },
    select: {
      valorUnitarioSnapshot: true,
      quantidade: true,
    },
  });
  const total = calculateComandaTotal(itens);
  await tx.comandaOperacao.update({
    where: { id: comandaId },
    data: { total },
  });
  return total;
}

async function buildItemData(
  tx: Prisma.TransactionClient,
  contaId: number,
  input: z.infer<typeof comandaItemInputSchema>
) {
  const quantidade = normalizePositiveNumber(
    input.quantidade,
    "Informe uma quantidade valida."
  );
  const valorUnitario = normalizePositiveNumber(
    input.valorUnitario,
    "Informe um valor unitario valido."
  );
  let origemId =
    input.origemId === null || input.origemId === undefined
      ? null
      : String(input.origemId);
  let nomeSnapshot = input.nome?.trim() || "";
  let estoqueDebitado = false;
  let quantidadeDebitada = new Decimal(0);

  if (input.origemTipo === "PRODUTO") {
    if (!origemId) throw new Error("Informe o produto da comanda.");
    if (!quantidade.isInteger()) {
      throw new Error("Quantidade de produto deve ser inteira.");
    }

    const produto = await tx.produto.findFirstOrThrow({
      where: { id: Number(origemId), contaId },
      include: { ProdutoBase: true },
    });

    if (produto.saidas === false) {
      throw new Error(`Produto ${produto.nome} nao permite saidas.`);
    }

    if (new Decimal(produto.estoque).lt(quantidade)) {
      throw new Error(`Produto ${produto.nome} nao possui estoque suficiente.`);
    }

    await tx.produto.update({
      where: { id: produto.id, contaId },
      data: { estoque: { decrement: quantidade.toNumber() } },
    });

    const baseName = produto.ProdutoBase?.nome || produto.nome;
    nomeSnapshot = `${baseName} / ${produto.nomeVariante || "Padrao"}`;
    estoqueDebitado = true;
    quantidadeDebitada = quantidade;
  }

  if (input.origemTipo === "SERVICO") {
    if (!origemId) throw new Error("Informe o servico da comanda.");
    const servico = await tx.servicos.findFirstOrThrow({
      where: { id: Number(origemId), contaId },
      select: { id: true, nome: true },
    });
    nomeSnapshot = servico.nome;
    origemId = String(servico.id);
  }

  if (input.origemTipo === "AVULSO") {
    origemId = null;
    if (!nomeSnapshot) throw new Error("Informe o nome do item avulso.");
  }

  return {
    origemTipo: input.origemTipo,
    origemId,
    nomeSnapshot,
    valorUnitarioSnapshot: valorUnitario,
    quantidade,
    subtotal: getItemSubtotal(valorUnitario, quantidade),
    estoqueDebitado,
    quantidadeDebitada,
  };
}

async function devolverEstoqueProduto(
  tx: Prisma.TransactionClient,
  params: {
    contaId: number;
    produtoId: number;
    quantidade: Decimal;
  }
) {
  if (params.quantidade.lte(0)) return;
  await tx.produto.update({
    where: { id: params.produtoId, contaId: params.contaId },
    data: { estoque: { increment: params.quantidade.toNumber() } },
  });
}

async function validateFinanceDefaults(params: {
  contaId: number;
  contaFinanceiraId?: number | null;
  categoriaFinanceiraId?: number | null;
}) {
  if (params.contaFinanceiraId) {
    const conta = await prisma.contasFinanceiro.findFirst({
      where: {
        id: params.contaFinanceiraId,
        contaId: params.contaId,
      },
      select: { id: true },
    });
    if (!conta) throw new Error("Conta financeira invalida para esta conta.");
  }

  if (params.categoriaFinanceiraId) {
    const categoria = await prisma.categoriaFinanceiro.findFirst({
      where: {
        id: params.categoriaFinanceiraId,
        contaId: params.contaId,
      },
      select: { id: true },
    });
    if (!categoria) throw new Error("Categoria financeira invalida para esta conta.");
  }
}

async function resolveClienteSnapshot(
  executor: PrismaExecutor,
  params: {
    contaId: number;
    clienteId?: number | null;
  }
) {
  if (!params.clienteId) {
    return { clienteId: null, clienteNomeSnapshot: null };
  }

  const cliente = await executor.clientesFornecedores.findFirst({
    where: {
      id: params.clienteId,
      contaId: params.contaId,
    },
    select: { id: true, nome: true },
  });

  if (!cliente) {
    throw new Error("Cliente invalido para esta conta.");
  }

  return {
    clienteId: cliente.id,
    clienteNomeSnapshot: cliente.nome,
  };
}

export async function getComandaConfiguracao(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const config = await prisma.comandaOperacaoConfiguracao.findUnique({
      where: { contaId: customData.contaId },
    });
    return ResponseHandler(res, "Configuracao encontrada.", config);
  } catch (error) {
    handleError(res, error);
  }
}

export async function saveComandaConfiguracao(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(
      canConfigureComandas(level),
      "Somente usuarios com permissao administrativa podem configurar comandas."
    );

    const parsed = saveConfigSchema.safeParse(req.body);
    if (!parsed.success) return handleError(res, parsed.error);

    await validateFinanceDefaults({
      contaId: customData.contaId,
      contaFinanceiraId: parsed.data.contaFinanceiraIdPadrao,
      categoriaFinanceiraId: parsed.data.categoriaFinanceiraIdPadrao,
    });

    const config = await prisma.comandaOperacaoConfiguracao.upsert({
      where: { contaId: customData.contaId },
      update: {
        contaFinanceiraIdPadrao: parsed.data.contaFinanceiraIdPadrao || null,
        categoriaFinanceiraIdPadrao:
          parsed.data.categoriaFinanceiraIdPadrao || null,
      },
      create: {
        contaId: customData.contaId,
        contaFinanceiraIdPadrao: parsed.data.contaFinanceiraIdPadrao || null,
        categoriaFinanceiraIdPadrao:
          parsed.data.categoriaFinanceiraIdPadrao || null,
      },
    });

    return ResponseHandler(res, "Configuracao salva com sucesso.", config);
  } catch (error) {
    handleError(res, error);
  }
}

export async function listComandas(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 10);
    const search = String(req.query.search || "").trim();
    const statuses = parseStatusQuery(String(req.query.status || "").trim());
    const inicio = req.query.inicio ? new Date(String(req.query.inicio)) : null;
    const fim = req.query.fim ? new Date(String(req.query.fim)) : null;
    const requestedSortBy = String(req.query.sortBy || "abertura");
    const order = req.query.order === "asc" ? "asc" : "desc";
    const sortBy = ["Uid", "status", "total", "abertura", "fechamento"].includes(
      requestedSortBy
    )
      ? requestedSortBy
      : "abertura";

    const where: Prisma.ComandaOperacaoWhereInput = {
      contaId: customData.contaId,
      ...(statuses.length === 1 ? { status: statuses[0] } : {}),
      ...(statuses.length > 1 ? { status: { in: statuses } } : {}),
      ...(inicio || fim
        ? {
            abertura: {
              ...(inicio && !Number.isNaN(inicio.getTime()) ? { gte: inicio } : {}),
              ...(fim && !Number.isNaN(fim.getTime()) ? { lte: fim } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { Uid: { contains: search } },
              { observacao: { contains: search } },
              { clienteNomeSnapshot: { contains: search } },
              { itens: { some: { nomeSnapshot: { contains: search } } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      prisma.comandaOperacao.count({ where }),
      prisma.comandaOperacao.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { itens: true, pagamentos: true },
        orderBy: { [sortBy]: order },
      }),
    ]);

    return res.json({
      data,
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
    const id = Number(req.params.id);
    const comanda = await prisma.comandaOperacao.findFirstOrThrow({
      where: { id, contaId: customData.contaId },
      include: {
        itens: { orderBy: { id: "asc" } },
        pagamentos: true,
        historicos: { orderBy: { createdAt: "desc" } },
      },
    });
    return ResponseHandler(res, "Comanda encontrada.", comanda);
  } catch (error) {
    handleError(res, error);
  }
}

export async function createComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);

    const parsed = createComandaSchema.safeParse(req.body);
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      const Uid = await createUniqueComandaUid(tx, customData.contaId);
      const clienteSnapshot = await resolveClienteSnapshot(tx, {
        contaId: customData.contaId,
        clienteId: parsed.data.clienteId,
      });
      const comanda = await tx.comandaOperacao.create({
        data: {
          Uid,
          contaId: customData.contaId,
          clienteId: clienteSnapshot.clienteId,
          clienteNomeSnapshot: clienteSnapshot.clienteNomeSnapshot,
          observacao: parsed.data.observacao || null,
          status: "ABERTA",
        },
      });

      const itens = [];
      for (const input of parsed.data.itens) {
        const itemData = await buildItemData(tx, customData.contaId, input);
        itens.push(
          await tx.comandaOperacaoItem.create({
            data: { comandaId: comanda.id, ...itemData },
          })
        );
      }

      const total = calculateComandaTotal(itens);
      const updated = await tx.comandaOperacao.update({
        where: { id: comanda.id },
        data: { total },
        include: { itens: true, pagamentos: true, historicos: true },
      });
      await addHistorico(tx, {
        comandaId: comanda.id,
        evento: "CRIADA",
        usuarioId: customData.userId,
        payload: { total: total.toNumber() },
      });
      return updated;
    });

    await checkLowStockAndNotify(
      customData.contaId,
      parsed.data.itens
        .filter((item) => item.origemTipo === "PRODUTO" && item.origemId)
        .map((item) => Number(item.origemId))
    );

    return ResponseHandler(res, "Comanda criada com sucesso.", response, 201);
  } catch (error) {
    handleError(res, error);
  }
}

export async function addComandaItens(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);
    const comandaId = Number(req.params.id);
    const parsed = addItensSchema.safeParse(req.body);
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      await assertComandaAberta(tx, comandaId, customData.contaId);
      const itens = [];
      for (const input of parsed.data.itens) {
        const itemData = await buildItemData(tx, customData.contaId, input);
        itens.push(
          await tx.comandaOperacaoItem.create({
            data: { comandaId, ...itemData },
          })
        );
      }
      const total = await recalculateComandaTotal(tx, comandaId);
      await addHistorico(tx, {
        comandaId,
        evento: "ITENS_ADICIONADOS",
        usuarioId: customData.userId,
        payload: { total: total.toNumber(), itens: itens.map((item) => item.id) },
      });
      return tx.comandaOperacao.findUnique({
        where: { id: comandaId },
        include: { itens: true, pagamentos: true, historicos: true },
      });
    });

    await checkLowStockAndNotify(
      customData.contaId,
      parsed.data.itens
        .filter((item) => item.origemTipo === "PRODUTO" && item.origemId)
        .map((item) => Number(item.origemId))
    );

    return ResponseHandler(res, "Itens adicionados com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function updateComandaItem(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);
    const comandaId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      await assertComandaAberta(tx, comandaId, customData.contaId);
      const item = await tx.comandaOperacaoItem.findFirstOrThrow({
        where: { id: itemId, comandaId },
      });

      const origemId =
        parsed.data.origemId === null || parsed.data.origemId === undefined
          ? null
          : String(parsed.data.origemId);
      const sameProduto =
        item.origemTipo === "PRODUTO" &&
        parsed.data.origemTipo === "PRODUTO" &&
        item.origemId === origemId;

      if (sameProduto) {
        const novaQuantidade = normalizePositiveNumber(
          parsed.data.quantidade,
          "Informe uma quantidade valida."
        );
        if (!novaQuantidade.isInteger()) {
          throw new Error("Quantidade de produto deve ser inteira.");
        }

        const delta = getProdutoStockDeltaForQuantityEdit(
          new Decimal(item.quantidade).toNumber(),
          novaQuantidade.toNumber()
        );

        if (delta.action === "DEBITAR") {
          const produto = await tx.produto.findFirstOrThrow({
            where: { id: Number(item.origemId), contaId: customData.contaId },
          });
          if (produto.saidas === false) {
            throw new Error(`Produto ${produto.nome} nao permite saidas.`);
          }
          if (new Decimal(produto.estoque).lt(delta.quantidade)) {
            throw new Error(`Produto ${produto.nome} nao possui estoque suficiente.`);
          }
          await tx.produto.update({
            where: { id: produto.id, contaId: customData.contaId },
            data: { estoque: { decrement: delta.quantidade } },
          });
        }

        if (delta.action === "REDUZIR") {
          if (parsed.data.devolverDiferencaEstoque === undefined) {
            throw new Error(
              "Informe se deseja devolver a diferenca ao estoque."
            );
          }
          if (parsed.data.devolverDiferencaEstoque) {
            await devolverEstoqueProduto(tx, {
              contaId: customData.contaId,
              produtoId: Number(item.origemId),
              quantidade: new Decimal(delta.quantidade),
            });
          }
        }
      } else if (requiresStockReturnDecision(item)) {
        if (parsed.data.devolverDiferencaEstoque === undefined) {
          throw new Error("Informe se deseja devolver o estoque do item anterior.");
        }
        if (parsed.data.devolverDiferencaEstoque && item.origemId) {
          const restante = new Decimal(item.quantidadeDebitada).minus(
            item.quantidadeDevolvida
          );
          await devolverEstoqueProduto(tx, {
            contaId: customData.contaId,
            produtoId: Number(item.origemId),
            quantidade: restante,
          });
        }
      }

      const itemData = sameProduto
        ? {
            ...(await buildItemSnapshotWithoutStock(
              tx,
              customData.contaId,
              parsed.data
            )),
            estoqueDebitado: item.estoqueDebitado,
            quantidadeDebitada: new Decimal(parsed.data.quantidade),
            estoqueDevolvido: false,
            quantidadeDevolvida: new Decimal(0),
          }
        : await buildItemData(tx, customData.contaId, parsed.data);

      const updated = await tx.comandaOperacaoItem.update({
        where: { id: item.id },
        data: itemData,
      });
      const total = await recalculateComandaTotal(tx, comandaId);
      await addHistorico(tx, {
        comandaId,
        evento: "ITEM_EDITADO",
        usuarioId: customData.userId,
        payload: { itemId, total: total.toNumber() },
      });
      return updated;
    });

    return ResponseHandler(res, "Item atualizado com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

async function buildItemSnapshotWithoutStock(
  tx: Prisma.TransactionClient,
  contaId: number,
  input: z.infer<typeof comandaItemInputSchema>
) {
  const quantidade = normalizePositiveNumber(
    input.quantidade,
    "Informe uma quantidade valida."
  );
  const valorUnitario = normalizePositiveNumber(
    input.valorUnitario,
    "Informe um valor unitario valido."
  );
  const origemId =
    input.origemId === null || input.origemId === undefined
      ? null
      : String(input.origemId);
  let nomeSnapshot = input.nome?.trim() || "";

  if (input.origemTipo === "PRODUTO") {
    if (!origemId) throw new Error("Informe o produto da comanda.");
    const produto = await tx.produto.findFirstOrThrow({
      where: { id: Number(origemId), contaId },
      include: { ProdutoBase: true },
    });
    const baseName = produto.ProdutoBase?.nome || produto.nome;
    nomeSnapshot = `${baseName} / ${produto.nomeVariante || "Padrao"}`;
  }

  if (input.origemTipo === "SERVICO") {
    if (!origemId) throw new Error("Informe o servico da comanda.");
    const servico = await tx.servicos.findFirstOrThrow({
      where: { id: Number(origemId), contaId },
      select: { nome: true },
    });
    nomeSnapshot = servico.nome;
  }

  if (input.origemTipo === "AVULSO" && !nomeSnapshot) {
    throw new Error("Informe o nome do item avulso.");
  }

  return {
    origemTipo: input.origemTipo,
    origemId,
    nomeSnapshot,
    valorUnitarioSnapshot: valorUnitario,
    quantidade,
    subtotal: getItemSubtotal(valorUnitario, quantidade),
  };
}

export async function removeComandaItem(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);
    const comandaId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const parsed = removeItemSchema.safeParse(req.body || {});
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaOperacao.findFirstOrThrow({
        where: { id: comandaId, contaId: customData.contaId },
        include: { itens: true },
      });
      const canForceDelete = canDeleteComanda(level);
      if (!canForceDelete && !canChangeComandaItems(comanda.status)) {
        throw new Error("So e possivel alterar itens em comandas abertas.");
      }
      const item = await tx.comandaOperacaoItem.findFirstOrThrow({
        where: { id: itemId, comandaId },
      });
      if (item.pagamentoId && !canForceDelete) {
        throw new Error("Somente usuarios admin podem remover itens faturados.");
      }

      if (
        requiresStockReturnDecision(item) &&
        parsed.data.devolverEstoque === undefined
      ) {
        throw new Error("Informe se deseja devolver o item ao estoque.");
      }

      if (
        requiresStockReturnDecision(item) &&
        parsed.data.devolverEstoque &&
        item.origemId
      ) {
        const restante = new Decimal(item.quantidadeDebitada).minus(
          item.quantidadeDevolvida
        );
        await devolverEstoqueProduto(tx, {
          contaId: customData.contaId,
          produtoId: Number(item.origemId),
          quantidade: restante,
        });
      }

      await tx.comandaOperacaoItem.delete({ where: { id: item.id } });
      const total = await recalculateComandaTotal(tx, comandaId);
      await addHistorico(tx, {
        comandaId,
        evento: "ITEM_REMOVIDO",
        usuarioId: customData.userId,
        payload: {
          itemId,
          devolverEstoque: parsed.data.devolverEstoque,
          total: total.toNumber(),
        },
      });
      return { total };
    });

    return ResponseHandler(res, "Item removido com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function deleteComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(
      canDeleteComanda(level),
      "Somente usuarios admin podem excluir comandas."
    );
    const comandaId = Number(req.params.id);
    const parsed = deleteComandaSchema.safeParse(req.body || {});
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaOperacao.findFirstOrThrow({
        where: { id: comandaId, contaId: customData.contaId },
        include: { itens: true },
      });
      const itensProduto = comanda.itens.filter((item) =>
        requiresStockReturnDecision(item)
      );
      if (itensProduto.length && parsed.data.devolverEstoque === undefined) {
        throw new Error("Informe se deseja devolver os produtos ao estoque.");
      }

      if (parsed.data.devolverEstoque) {
        for (const item of itensProduto) {
          if (!item.origemId) continue;
          const restante = new Decimal(item.quantidadeDebitada).minus(
            item.quantidadeDevolvida
          );
          await devolverEstoqueProduto(tx, {
            contaId: customData.contaId,
            produtoId: Number(item.origemId),
            quantidade: restante,
          });
        }
      }

      await tx.comandaOperacao.delete({ where: { id: comanda.id } });

      return {
        id: comanda.id,
        Uid: comanda.Uid,
        devolverEstoque: parsed.data.devolverEstoque,
      };
    });

    return ResponseHandler(res, "Comanda excluida com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function fecharComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);
    const comandaId = Number(req.params.id);

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await assertComandaAberta(
        tx,
        comandaId,
        customData.contaId
      );
      if (!comanda.itens.length) {
        throw new Error("Inclua ao menos um item antes de fechar a comanda.");
      }
      const total = await recalculateComandaTotal(tx, comandaId);
      const updated = await tx.comandaOperacao.update({
        where: { id: comandaId },
        data: { status: "PENDENTE", fechamento: new Date(), total },
        include: { itens: true, pagamentos: true, historicos: true },
      });
      await addHistorico(tx, {
        comandaId,
        evento: "FECHADA",
        usuarioId: customData.userId,
        payload: { total: total.toNumber() },
      });
      return updated;
    });

    return ResponseHandler(res, "Comanda fechada com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function faturarComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(canFaturarComanda(level));
    const comandaId = Number(req.params.id);
    const parsed = faturarSchema.safeParse(req.body);
    if (!parsed.success) return handleError(res, parsed.error);

    const dataPagamento = parseDate(parsed.data.dataPagamento);
    const config = parsed.data.lancarFinanceiro
      ? await prisma.comandaOperacaoConfiguracao.findUnique({
          where: { contaId: customData.contaId },
        })
      : null;

    const contaFinanceiraId =
      parsed.data.contaFinanceiraId || config?.contaFinanceiraIdPadrao || null;
    const categoriaFinanceiraId =
      parsed.data.categoriaFinanceiraId ||
      config?.categoriaFinanceiraIdPadrao ||
      null;

    if (parsed.data.lancarFinanceiro) {
      assertPermission(
        canFaturarComandaComFinanceiro(level),
        "Voce nao tem permissao para lancar a comanda no financeiro."
      );
      if (!contaFinanceiraId || !categoriaFinanceiraId) {
        throw new Error(
          "Informe conta e categoria financeira para lancar a comanda."
        );
      }
      await validateFinanceDefaults({
        contaId: customData.contaId,
        contaFinanceiraId,
        categoriaFinanceiraId,
      });
    }

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaOperacao.findFirstOrThrow({
        where: { id: comandaId, contaId: customData.contaId },
        include: { itens: true },
      });
      if (comanda.status !== "PENDENTE") {
        throw new Error("So e possivel faturar comandas pendentes.");
      }

      const itemIds = resolveComandaPaymentItemIds(parsed.data.itemIds);
      const total = calculateComandaPaymentTotal(comanda.itens, itemIds);
      let financeiroLancamentoIdSnapshot: number | null = null;
      if (parsed.data.lancarFinanceiro) {
        const lancamentoTx = await criarLancamentoFinanceiro(
          tx,
          customData.contaId,
          {
            descricao: `Comanda ${comanda.Uid} - ${itemIds.length} item(ns)`,
            valorTotal: total.toNumber(),
            tipoLancamentoModo: "AVISTA",
            lancamentoEfetivado: true,
            tipo: "RECEITA",
            formaPagamento: mapMetodoFinanceiro(parsed.data.metodo),
            status: "PAGO",
            categoriaId: categoriaFinanceiraId!,
            dataLancamento: dataPagamento,
            parcelas: 1,
            contasFinanceiroId: contaFinanceiraId!,
          },
          { skipNotification: true }
        );
        financeiroLancamentoIdSnapshot = lancamentoTx.id;
      }

      const pagamento = await tx.comandaOperacaoPagamento.create({
        data: {
          comandaId,
          metodo: parsed.data.metodo,
          valor: total,
          dataPagamento,
          lancarFinanceiro: parsed.data.lancarFinanceiro,
          financeiroLancamentoIdSnapshot,
          contaFinanceiraIdSnapshot: contaFinanceiraId,
          categoriaFinanceiraIdSnapshot: categoriaFinanceiraId,
        },
      });

      const itensFaturados = await tx.comandaOperacaoItem.updateMany({
        where: {
          comandaId,
          id: { in: itemIds },
          pagamentoId: null,
        },
        data: { pagamentoId: pagamento.id },
      });
      if (itensFaturados.count !== itemIds.length) {
        throw new Error(
          "Um ou mais itens selecionados ja foram faturados. Atualize a comanda e tente novamente."
        );
      }

      // Registra as saidas de estoque dos produtos faturados para que a
      // comanda apareca nas movimentacoes de produto (auditoria de estoque).
      for (const item of comanda.itens) {
        if (
          !itemIds.includes(item.id) ||
          item.origemTipo !== "PRODUTO" ||
          !item.origemId
        ) {
          continue;
        }

        await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            produtoId: Number(item.origemId),
            tipo: "SAIDA",
            status: "CONCLUIDO",
            quantidade: new Decimal(item.quantidade).toNumber(),
            custo: item.valorUnitarioSnapshot,
            contaId: customData.contaId,
            clienteFornecedor: comanda.clienteId ?? null,
            data: dataPagamento,
          },
        });
      }

      const itensAtualizados = comanda.itens.map((item) =>
        itemIds.includes(item.id)
          ? { ...item, pagamentoId: pagamento.id }
          : item
      );
      const nextStatus = getStatusAfterPayment(itensAtualizados);
      const updated = await tx.comandaOperacao.update({
        where: { id: comandaId },
        data: {
          status: nextStatus,
          faturamento: nextStatus === "FATURADA" ? dataPagamento : null,
          total: calculateComandaTotal(comanda.itens),
        },
        include: { itens: true, pagamentos: true, historicos: true },
      });
      await addHistorico(tx, {
        comandaId,
        evento: nextStatus === "FATURADA" ? "FATURADA" : "PAGAMENTO_PARCIAL",
        usuarioId: customData.userId,
        payload: {
          pagamentoId: pagamento.id,
          itemIds,
          total: total.toNumber(),
          lancarFinanceiro: parsed.data.lancarFinanceiro,
          financeiroLancamentoIdSnapshot,
        },
      });
      return updated;
    });

    if (parsed.data.lancarFinanceiro) {
      sendFinanceiroUpdated(customData.contaId, {
        reason: "comanda-faturada",
        comandaId,
      });
    }

    return ResponseHandler(res, "Comanda faturada com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function cancelarComanda(req: Request, res: Response): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const level = await getPermissionLevel(customData.contaId, customData.userId);
    assertPermission(level >= 2);
    const comandaId = Number(req.params.id);
    const parsed = cancelarSchema.safeParse(req.body || {});
    if (!parsed.success) return handleError(res, parsed.error);

    const response = await prisma.$transaction(async (tx) => {
      const comanda = await tx.comandaOperacao.findFirstOrThrow({
        where: { id: comandaId, contaId: customData.contaId },
        include: { itens: true },
      });
      if (comanda.status === "FATURADA") {
        throw new Error("Comandas faturadas nao podem ser canceladas.");
      }
      if (comanda.status === "CANCELADA") {
        throw new Error("Comanda ja esta cancelada.");
      }
      if (comanda.itens.some((item) => item.pagamentoId)) {
        throw new Error(
          "Comanda com itens faturados nao pode ser cancelada por este fluxo."
        );
      }

      const itensProduto = comanda.itens.filter((item) =>
        requiresStockReturnDecision(item)
      );
      if (itensProduto.length && parsed.data.devolverEstoque === undefined) {
        throw new Error("Informe se deseja devolver os produtos ao estoque.");
      }

      if (parsed.data.devolverEstoque) {
        for (const item of itensProduto) {
          if (!item.origemId) continue;
          const restante = new Decimal(item.quantidadeDebitada).minus(
            item.quantidadeDevolvida
          );
          await devolverEstoqueProduto(tx, {
            contaId: customData.contaId,
            produtoId: Number(item.origemId),
            quantidade: restante,
          });
          await tx.comandaOperacaoItem.update({
            where: { id: item.id },
            data: {
              estoqueDevolvido: true,
              quantidadeDevolvida: new Decimal(item.quantidadeDevolvida).plus(
                restante
              ),
            },
          });
        }
      }

      const updated = await tx.comandaOperacao.update({
        where: { id: comandaId },
        data: { status: "CANCELADA", cancelamento: new Date() },
        include: { itens: true, pagamentos: true, historicos: true },
      });
      await addHistorico(tx, {
        comandaId,
        evento: "CANCELADA",
        usuarioId: customData.userId,
        payload: {
          devolverEstoque: parsed.data.devolverEstoque,
          observacao: parsed.data.observacao || null,
        },
      });
      return updated;
    });

    return ResponseHandler(res, "Comanda cancelada com sucesso.", response);
  } catch (error) {
    handleError(res, error);
  }
}

export async function gerarComandaComprovante(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: customData.contaId },
    });
    const comanda = await prisma.comandaOperacao.findFirstOrThrow({
      where: { id: Number(req.params.id), contaId: customData.contaId },
      include: {
        itens: { orderBy: { id: "asc" } },
        pagamentos: { orderBy: { dataPagamento: "desc" } },
      },
    });

    const doc = new PDFDocument({
      size: [
        COMANDA_RECEIPT_80MM_WIDTH_POINTS,
        calculateComandaReceiptHeight(comanda.itens.length, comanda.pagamentos.length),
      ],
      margin: 10,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=${buildComandaPdfFilename(comanda.Uid)}`
    );
    doc.pipe(res);

    doc.registerFont("Roboto", "./public/fonts/Roboto-Regular.ttf");
    doc.registerFont("Roboto-Bold", "./public/fonts/Roboto-Bold.ttf");
    doc.font("Roboto");

    const contentWidth = COMANDA_RECEIPT_80MM_WIDTH_POINTS - 20;
    const drawSeparator = () => {
      doc
        .moveDown(0.25)
        .font("Roboto")
        .fontSize(7)
        .text("-".repeat(48), { align: "center", width: contentWidth })
        .moveDown(0.25);
    };
    const drawPair = (label: string, value: string, bold = false) => {
      doc
        .font(bold ? "Roboto-Bold" : "Roboto")
        .fontSize(bold ? 9 : 8)
        .text(label, { continued: true, width: contentWidth * 0.55 })
        .text(value, { align: "right", width: contentWidth * 0.45 });
    };

    const logoSource = await resolveRenderableImageSource(conta.profile);
    if (logoSource) {
      doc.image(logoSource, (COMANDA_RECEIPT_80MM_WIDTH_POINTS - 46) / 2, doc.y, {
        fit: [46, 46],
      });
      doc.moveDown(3.4);
    }

    doc
      .font("Roboto-Bold")
      .fontSize(12)
      .text(conta.nome, { align: "center", width: contentWidth });
    doc
      .font("Roboto")
      .fontSize(7)
      .text(conta.email || "", { align: "center", width: contentWidth })
      .text(conta.documento || "Sem documento", {
        align: "center",
        width: contentWidth,
      })
      .text(conta.telefone || "Sem telefone", {
        align: "center",
        width: contentWidth,
      });

    drawSeparator();

    doc
      .font("Roboto-Bold")
      .fontSize(10)
      .text("COMPROVANTE DE COMANDA", { align: "center", width: contentWidth });
    doc
      .font("Roboto")
      .fontSize(8)
      .text(`Comanda: ${comanda.Uid}`, { width: contentWidth })
      .text(`Status: ${comanda.status}`, { width: contentWidth })
      .text(`Abertura: ${formatComandaReceiptDateTime(comanda.abertura) || "-"}`, {
        width: contentWidth,
      });

    if (comanda.fechamento) {
      doc.text(
        `Fechamento: ${formatComandaReceiptDateTime(comanda.fechamento) || "-"}`,
        { width: contentWidth }
      );
    }
    if (comanda.faturamento) {
      doc.text(
        `Faturamento: ${formatComandaReceiptDateTime(comanda.faturamento) || "-"}`,
        { width: contentWidth }
      );
    }
    if (comanda.cancelamento) {
      doc.text(
        `Cancelamento: ${formatComandaReceiptDateTime(comanda.cancelamento) || "-"}`,
        { width: contentWidth }
      );
    }
    doc.text(`Cliente: ${comanda.clienteNomeSnapshot || "Nao informado"}`, {
      width: contentWidth,
    });

    drawSeparator();

    doc.font("Roboto-Bold").fontSize(8).text("ITENS", { width: contentWidth });
    doc.moveDown(0.2);

    for (const item of comanda.itens) {
      doc
        .font("Roboto-Bold")
        .fontSize(8)
        .text(item.nomeSnapshot.substring(0, 42), { width: contentWidth });
      doc
        .font("Roboto")
        .fontSize(8)
        .text(
          `${new Decimal(item.quantidade).toString()} x ${formatComandaReceiptCurrency(
            item.valorUnitarioSnapshot
          )}`,
          { continued: true, width: contentWidth * 0.55 }
        )
        .text(formatComandaReceiptCurrency(item.subtotal), {
          align: "right",
          width: contentWidth * 0.45,
        });
      if (item.pagamentoId) {
        doc.fontSize(7).text("Item faturado", { width: contentWidth });
      }
      doc.moveDown(0.25);
    }

    drawSeparator();

    const totalPago = comanda.pagamentos
      .reduce((total, pagamento) => total.plus(pagamento.valor), new Decimal(0))
      .toDecimalPlaces(2);
    const totalAberto = new Decimal(comanda.total).minus(totalPago).toDecimalPlaces(2);

    drawPair("Total", formatComandaReceiptCurrency(comanda.total), true);
    drawPair("Pago", formatComandaReceiptCurrency(totalPago));
    drawPair("Em aberto", formatComandaReceiptCurrency(totalAberto), true);

    if (comanda.pagamentos.length) {
      drawSeparator();
      doc.font("Roboto-Bold").fontSize(8).text("PAGAMENTOS", {
        width: contentWidth,
      });
      for (const pagamento of comanda.pagamentos) {
        drawPair(
          `${pagamento.metodo} ${formatComandaReceiptDateTime(
            pagamento.dataPagamento
          ) || ""}`.trim(),
          formatComandaReceiptCurrency(pagamento.valor)
        );
      }
    }

    if (comanda.observacao) {
      drawSeparator();
      doc
        .font("Roboto")
        .fontSize(7)
        .text(`Obs: ${comanda.observacao}`, { width: contentWidth });
    }

    drawSeparator();
    doc
      .font("Roboto")
      .fontSize(8)
      .text("Cupom nao fiscal", { align: "center", width: contentWidth })
      .text("Obrigado pela preferencia!", {
        align: "center",
        width: contentWidth,
      });

    doc.end();
  } catch (error) {
    handleError(res, error);
  }
}

export async function gerarComandaComprovantePos(
  req: Request,
  res: Response
): Promise<any> {
  try {
    const customData = getCustomRequest(req).customData;
    const conta = await prisma.contas.findUniqueOrThrow({
      where: { id: customData.contaId },
    });
    const comanda = await prisma.comandaOperacao.findFirstOrThrow({
      where: { id: Number(req.params.id), contaId: customData.contaId },
      include: {
        itens: { orderBy: { id: "asc" } },
        pagamentos: { orderBy: { dataPagamento: "desc" } },
      },
    });

    const cupom = buildComandaPosReceipt(conta, comanda);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=${buildComandaPosFilename(comanda.Uid)}`
    );
    return res.send(cupom);
  } catch (error) {
    handleError(res, error);
  }
}
