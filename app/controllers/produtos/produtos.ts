import { Request, Response } from "express";
import { clampPageSize, sanitizeSort } from "../../utils/pagination";
import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import { Prisma, Status } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { handleError } from "../../utils/handleError";
import {
  DescarteEstoqueSchema,
  ProdutoCategoriaSchema,
  ProdutoSchema,
  ReposicaoEstoqueSchema,
  ReposicaoLoteSchema,
} from "../../schemas/produtos";
import { emailScheduleService } from "../../services/emailScheduleQueueService";
import { enqueuePushNotificationByPreference } from "../../services/notifications/notificationPreferenceService";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import { mapperErrorSchema } from "../../mappers/schemasErros";
import { ResponseHandler } from "../../utils/response";
import { gerarIdUnicoComMetaFinal } from "../../helpers/generateUUID";
import { z } from "zod";
import {
  canDiscardProdutoStock,
} from "../../services/produtos/estoqueService";
import { assertAvailableAndDecrement } from "../../services/loja/lojaInventoryService";
import {
  buildScopedUploadKey,
  deleteStoredFile,
  uploadPublicFile,
} from "../../services/uploads/fileStorageService";
import { downscaleImage } from "../../services/uploads/imageProcessingService";
import { contaHasActiveModule } from "../../services/contas/storeModulesService";

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
    imagem: variantePadrao?.imagem ?? null,
    mostrarNoCatalogo: variantePadrao?.mostrarNoCatalogo ?? true,
    nomeVariante: variantePadrao?.nomeVariante ?? "Padrão",
    preco: variantePadrao?.preco ?? 0,
    precoPromocional: variantePadrao?.precoPromocional ?? null,
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

/** Erro de regra de negócio: SKU bloqueado por possuir movimentações. */
class SkuBloqueadoError extends Error {}

/**
 * Normaliza um trecho de texto para compor o SKU:
 * remove acentos, mantém apenas letras/números e converte para maiúsculas.
 */
function normalizarParteSku(texto: string | null | undefined, max: number): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, max);
}

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

/**
 * Gera um SKU único para a conta com base no nome do produto e da variante.
 * Ex.: "Camiseta Básica" + "Azul M" => "CAMISE-AZULM-4F7A".
 */
async function gerarSkuUnico(
  client: PrismaClientLike,
  contaId: number,
  nome: string,
  nomeVariante?: string | null
): Promise<string> {
  const parteNome = normalizarParteSku(nome, 6);
  const parteVariante =
    nomeVariante && nomeVariante !== "Padrão"
      ? normalizarParteSku(nomeVariante, 4)
      : "";
  const prefixo = [parteNome, parteVariante].filter(Boolean).join("-") || "SKU";

  for (let tentativa = 0; tentativa < 25; tentativa++) {
    const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
    const codigo = `${prefixo}-${sufixo}`;
    const existente = await client.produto.findFirst({
      where: { contaId, codigo },
      select: { id: true },
    });
    if (!existente) return codigo;
  }

  return `${prefixo}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Indica se a variante possui movimentações que travam a alteração do SKU
 * (itens de vendas ou de ordens de serviço).
 */
async function produtoTemMovimentacoes(
  client: PrismaClientLike,
  varianteId?: number | null
): Promise<boolean> {
  if (!varianteId) return false;
  const [vendas, ordens] = await Promise.all([
    client.itensVendas.count({ where: { produtoId: varianteId } }),
    client.itensOrdensServico.count({ where: { produtoId: varianteId } }),
  ]);
  return vendas > 0 || ordens > 0;
}

/**
 * Verifica se o SKU de uma variante pode ser alterado.
 * Uma vez que o item tenha movimentações (vendas ou ordens de serviço),
 * o SKU fica bloqueado até que essas conexões sejam removidas.
 * Retorna uma mensagem de bloqueio ou null quando a alteração é permitida.
 */
async function verificarBloqueioSku(
  client: PrismaClientLike,
  variante: { id: number; codigo: string | null },
  novoCodigo?: string | null
): Promise<string | null> {
  const atual = (variante.codigo ?? "").trim();
  const novo = (novoCodigo ?? "").trim();

  // Sem alteração ou definindo o SKU pela primeira vez: permitido.
  if (atual === novo || !atual) return null;

  const [vendas, ordens] = await Promise.all([
    client.itensVendas.count({ where: { produtoId: variante.id } }),
    client.itensOrdensServico.count({ where: { produtoId: variante.id } }),
  ]);

  if (vendas === 0 && ordens === 0) return null;

  const partes: string[] = [];
  if (vendas > 0) partes.push(`${vendas} venda(s)`);
  if (ordens > 0) partes.push(`${ordens} ordem(ns) de serviço`);

  return `Não é possível alterar o SKU: existem ${partes.join(
    " e "
  )} vinculada(s) a este item. Remova essas conexões para poder alterar o SKU.`;
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

    const responseData = buildProdutoBaseResponse(produto);
    const skuBloqueado = await produtoTemMovimentacoes(
      prisma,
      responseData.variantePadraoId
    );

    return res.status(200).json({
      message: "Produto encontrado",
      data: { ...responseData, skuBloqueado },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Catálogo público (loja virtual): endpoint SEM autenticação. A conta é identificada pelo id
// (o frontend decodifica o hash da URL e envia o id real, mesmo padrão do cadastro público de
// clientes). Retorna os dados da loja e todos os produtos ativos da conta agrupados por base.
// Obs.: por enquanto mostra todos os produtos ativos; o controle de "aparecer no catálogo" por
// produto virá depois.
export const getCatalogoPublico = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const contaId = Number(req.query.contaId);
    if (!contaId || Number.isNaN(contaId)) {
      return ResponseHandler(res, "Loja não encontrada", null, 400);
    }

    const conta = await prisma.contas.findFirst({
      where: { id: contaId },
      select: { id: true, nome: true, nomeFantasia: true, profile: true, telefone: true },
    });
    if (!conta) {
      return ResponseHandler(res, "Loja não encontrada", null, 404);
    }

    const bases = await prisma.produtoBase.findMany({
      where: { contaId, status: Status.ATIVO },
      include: {
        Categoria: { select: { nome: true } },
        variantes: {
          where: { status: Status.ATIVO, mostrarNoCatalogo: true },
          orderBy: [{ ehPadrao: "desc" }, { id: "asc" }],
        },
      },
      orderBy: { nome: "asc" },
    });

    const produtos = bases
      .filter((base) => base.variantes.length > 0)
      .map((base) => {
        const variantes = base.variantes.map((variante) => ({
          id: variante.id,
          nomeVariante: variante.nomeVariante,
          preco: variante.preco,
          imagem: variante.imagem,
          unidade: variante.unidade,
          estoque: variante.estoque,
          controlaEstoque: variante.controlaEstoque,
          ehPadrao: variante.ehPadrao,
        }));
        const capa = variantes.find((v) => v.imagem)?.imagem ?? null;
        const precos = variantes.map((v) => Number(v.preco) || 0);

        return {
          id: base.id,
          nome: base.nome,
          descricao: base.descricao,
          categoria: base.Categoria?.nome ?? null,
          imagem: capa,
          precoMin: Math.min(...precos),
          precoMax: Math.max(...precos),
          totalVariantes: variantes.length,
          variantes,
        };
      });

    const categorias = Array.from(
      new Set(produtos.map((p) => p.categoria).filter((c): c is string => Boolean(c)))
    ).sort((a, b) => a.localeCompare(b));

    // Loja Virtual (módulo pago): quando ativa, a vitrine é renderizada como loja completa e
    // personalizada. Sem o módulo, permanece o catálogo gratuito. Retornamos o estado + a config
    // pública (sem campos sensíveis) para o frontend decidir a experiência.
    const lojaAtiva = await contaHasActiveModule(contaId, "loja-virtual");
    const lojaConfigRaw = lojaAtiva
      ? await prisma.lojaVirtualConfig.findUnique({ where: { contaId } })
      : null;
    const loja = {
      ativa: lojaAtiva,
      config: lojaConfigRaw
        ? {
            corPrimaria: lojaConfigRaw.corPrimaria,
            corSecundaria: lojaConfigRaw.corSecundaria,
            headerEstilo: lojaConfigRaw.headerEstilo,
            bannerUrl: lojaConfigRaw.bannerUrl,
            bannerTitulo: lojaConfigRaw.bannerTitulo,
            bannerSubtitulo: lojaConfigRaw.bannerSubtitulo,
            mensagemBoasVindas: lojaConfigRaw.mensagemBoasVindas,
            mostrarPrecos: lojaConfigRaw.mostrarPrecos,
            pedidoWhatsapp: lojaConfigRaw.pedidoWhatsapp,
          }
        : null,
    };

    return ResponseHandler(res, "Catálogo encontrado", { conta, produtos, categorias, loja });
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
      ...(query?.skip ? { skip: Number(query.skip) } : {}),
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

    // Tratativa: apaga as imagens das variantes excluídas para não ocupar espaço no storage.
    for (const variante of produto.variantes) {
      if (variante.imagem) {
        await deleteStoredFile(variante.imagem).catch(() => undefined);
      }
    }

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

const catalogoVisibilidadeSchema = z.object({
  // No modo "base" os ids são de produtos base (aplica a todas as variantes deles);
  // no modo "variante" os ids são das variantes (produtos) diretamente.
  scope: z.enum(["base", "variante"]).default("variante"),
  mostrarNoCatalogo: z.boolean(),
  ids: z.array(z.number().int().positive()).min(1, "Selecione ao menos um produto"),
});

// Ação em massa: mostra/oculta produtos (e suas variantes) no catálogo/loja online pública.
export const setCatalogoVisibilidade = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const parsed = catalogoVisibilidadeSchema.safeParse(req.body);
    if (!parsed.success) {
      return ResponseHandler(res, "Dados inválidos", mapperErrorSchema(parsed.error), 400);
    }
    const { scope, mostrarNoCatalogo, ids } = parsed.data;

    const where =
      scope === "base"
        ? { contaId: customData.contaId, produtoBaseId: { in: ids } }
        : { contaId: customData.contaId, id: { in: ids } };

    const result = await prisma.produto.updateMany({
      where,
      data: { mostrarNoCatalogo },
    });

    return ResponseHandler(
      res,
      mostrarNoCatalogo
        ? "Produtos exibidos no catálogo online"
        : "Produtos ocultados do catálogo online",
      { atualizados: result.count }
    );
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

    // Campos fiscais gravados na variante (padrão). null limpa; undefined (não enviado) é ignorado pelo Prisma.
    const fiscalData = {
      ncm: data.ncm,
      cest: data.cest,
      cfop: data.cfop,
      origem: data.origem,
      codigoProduto: data.codigoProduto,
      aliquotaIcms: data.aliquotaIcms,
      aliquotaIpi: data.aliquotaIpi,
      aliquotaPis: data.aliquotaPis,
      aliquotaCofins: data.aliquotaCofins,
      issAliquota: data.issAliquota,
    };

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
            ...fiscalData,
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
          const bloqueioSku = await verificarBloqueioSku(
            tx,
            variantePadrao,
            data.codigo
          );
          if (bloqueioSku) throw new SkuBloqueadoError(bloqueioSku);

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
              precoPromocional: data.precoPromocional ?? null,
              entradas: data.entradas,
              saidas: data.saidas,
              controlaEstoque: data.controlaEstoque,
              producaoLocal: data.producaoLocal,
              mostrarNoPdv: data.mostrarNoPdv,
              mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
              materiaPrima: data.materiaPrima,
              custoMedioProducao: data.custoMedioProducao,
              ...fiscalData,
            },
          });
        } else {
          const codigoFinal =
            data.codigo?.trim() ||
            (await gerarSkuUnico(
              tx,
              customData.contaId,
              data.nome,
              data.nomeVariante
            ));
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
              precoPromocional: data.precoPromocional ?? null,
              descricao: data.descricao,
              precoCompra: data.precoCompra,
              unidade: data.unidade,
              codigo: codigoFinal,
              minimo: data.minimo as number,
              entradas: data.entradas,
              saidas: data.saidas,
              controlaEstoque: data.controlaEstoque,
              producaoLocal: data.producaoLocal,
              mostrarNoPdv: data.mostrarNoPdv,
              mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
              materiaPrima: data.materiaPrima,
              custoMedioProducao: data.custoMedioProducao,
              ...fiscalData,
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
          ...fiscalData,
        },
      });

      const codigoFinal =
        data.codigo?.trim() ||
        (await gerarSkuUnico(
          tx,
          customData.contaId,
          data.nome,
          data.nomeVariante
        ));

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
          codigo: codigoFinal,
          minimo: data.minimo as number,
          entradas: data.entradas,
          saidas: data.saidas,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          categoria: categoriaNome,
          ...fiscalData,
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
    if (error instanceof SkuBloqueadoError) {
      return ResponseHandler(res, error.message, null, 409);
    }
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

export const reposicaoLoteProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const parsed = ReposicaoLoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return handleError(res, parsed.error);
  }
  const data = parsed.data;

  try {
    // Rateio de frete e desconto proporcional ao subtotal (custo * quantidade)
    // de cada item. O resíduo de arredondamento vai para o último item.
    const freteTotal = new Decimal(data.frete || 0);
    const descontoTotal = new Decimal(data.desconto || 0);
    const totalBase = data.itens.reduce(
      (acc, item) =>
        acc.plus(new Decimal(Number(item.custo)).times(Number(item.quantidade))),
      new Decimal(0)
    );

    const resultado = await prisma.$transaction(async (tx) => {
      const movimentacoes = [];
      let freteAcumulado = new Decimal(0);
      let descontoAcumulado = new Decimal(0);

      for (let i = 0; i < data.itens.length; i++) {
        const item = data.itens[i];
        const produtoId = Number(item.produtoId);
        const quantidade = Number(item.quantidade);
        const custo = Number(item.custo);
        const isUltimo = i === data.itens.length - 1;

        const produtoExistente = await tx.produto.findFirst({
          where: {
            contaId: customData.contaId,
            id: produtoId,
          },
          select: {
            id: true,
            nome: true,
            nomeVariante: true,
            unidade: true,
            entradas: true,
          },
        });

        if (!produtoExistente) {
          throw new Error(`Produto #${produtoId} não encontrado.`);
        }

        if (produtoExistente.entradas === false) {
          throw new Error(
            `O produto ${produtoExistente.nome} não permite entradas de estoque, altere isso antes de continuar.`
          );
        }

        const base = new Decimal(custo).times(quantidade);
        const peso = totalBase.gt(0)
          ? base.div(totalBase)
          : new Decimal(1).div(data.itens.length);

        const freteItem = isUltimo
          ? freteTotal.minus(freteAcumulado)
          : freteTotal.times(peso).toDecimalPlaces(2);
        const descontoItem = isUltimo
          ? descontoTotal.minus(descontoAcumulado)
          : descontoTotal.times(peso).toDecimalPlaces(2);

        freteAcumulado = freteAcumulado.plus(freteItem);
        descontoAcumulado = descontoAcumulado.plus(descontoItem);

        await tx.produto.update({
          where: { id: produtoId, contaId: customData.contaId },
          data: { estoque: { increment: quantidade } },
        });

        const movimentacao = await tx.movimentacoesEstoque.create({
          data: {
            Uid: gerarIdUnicoComMetaFinal("MOV"),
            produtoId: produtoId,
            tipo: "ENTRADA",
            status: "CONCLUIDO",
            quantidade: quantidade,
            custo: custo,
            contaId: customData.contaId,
            clienteFornecedor: data.fornecedor ?? null,
            notaFiscal: data.notaFiscal ?? null,
            frete: freteItem.toNumber(),
            desconto: descontoItem.toNumber(),
            ...(data.data ? { data: data.data } : {}),
          },
        });

        movimentacoes.push({ movimentacao, produto: produtoExistente });
      }

      return movimentacoes;
    });

    const totalItens = resultado.length;
    const totalUnidades = resultado.reduce(
      (acc, item) => acc + item.movimentacao.quantidade,
      0
    );

    await enqueuePushNotificationByPreference(
      "PRODUTO_ALTERADO",
      {
        title: "Reposição de estoque em massa",
        body: `${totalItens} produto(s) repostos (${totalUnidades} unidade(s) no total).`,
      },
      customData.contaId
    );

    return ResponseHandler(
      res,
      "Reposição em massa realizada com sucesso",
      {
        totalItens,
        totalUnidades,
        movimentacoes: resultado.map((item) => ({
          ...item.movimentacao,
          Produto: item.produto,
        })),
      },
      201
    );
  } catch (error) {
    handleError(res, error);
  }
};

export const descarteProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  const customData = getCustomRequest(req).customData;
  const parsedDescarte = DescarteEstoqueSchema.safeParse(req.body);
  if (!parsedDescarte.success) {
    return handleError(res, parsedDescarte.error);
  }

  const data = parsedDescarte.data;
  const produtoId = data.produtoId;
  const quantidade = data.quantidade;
  if (!produtoId || !quantidade) return ResponseHandler(res, "Produto e quantidade são obrigatórios", null, 422);

  try {
    const produto = await prisma.$transaction(async (tx) => {
      const produtoExistente = await tx.produto.findFirst({
        where: {
          contaId: customData.contaId,
          id: produtoId,
        },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          estoque: true,
          unidade: true,
          controlaEstoque: true,
        },
      });

      if (!produtoExistente) {
        throw new Error("Produto nao encontrado.");
      }

      if (produtoExistente.controlaEstoque === false) {
        throw new Error("Produto nao controla estoque.");
      }

      if (!canDiscardProdutoStock(produtoExistente.estoque, quantidade)) {
        throw new Error(
          `Estoque insuficiente para descarte. Disponivel: ${produtoExistente.estoque}.`
        );
      }

      await assertAvailableAndDecrement(tx, customData.contaId, produtoId, quantidade);
      await tx.movimentacoesEstoque.create({
        data: {
          Uid: gerarIdUnicoComMetaFinal("MOV"),
          contaId: customData.contaId,
          produtoId,
          quantidade,
          custo: 0,
          tipo: "DESCARTE",
          status: "CONCLUIDO",
          notaFiscal: data.motivo || null,
        },
      });
      return tx.produto.findFirstOrThrow({
        where: { id: produtoId, contaId: customData.contaId },
        select: {
          id: true,
          nome: true,
          nomeVariante: true,
          estoque: true,
          unidade: true,
        },
      });
    });

    await enqueuePushNotificationByPreference(
      "PRODUTO_ALTERADO",
      {
        title: "Descarte de produto",
        body: `A variante ${produto.nome} / ${produto.nomeVariante || "Padrao"} teve ${quantidade} ${produto.unidade || "un"} descartado(s).`,
      },
      customData.contaId
    );

    return ResponseHandler(
      res,
      "Descarte registrado com sucesso",
      {
        produto,
        quantidade,
        motivo: data.motivo || null,
      },
      200
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

    const skuBloqueado = await produtoTemMovimentacoes(prisma, variante.id);

    return ResponseHandler(res, "Variante encontrada", {
      ...variante,
      categoriaId: variante.ProdutoBase?.categoriaId ?? null,
      categoria: variante.ProdutoBase?.Categoria?.nome ?? null,
      produtoBaseNome: variante.ProdutoBase?.nome ?? variante.nome,
      label: `${variante.nome}${variante.nomeVariante ? ` / ${variante.nomeVariante}` : ""}`,
      skuBloqueado,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const gerarSkuProduto = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    let nome = String(req.query.nome ?? "").trim();
    const nomeVariante = req.query.nomeVariante
      ? String(req.query.nomeVariante)
      : null;
    const produtoBaseId = req.query.produtoBaseId
      ? Number(req.query.produtoBaseId)
      : null;

    // No cadastro de variante temos apenas o id do produto base: buscamos o nome.
    if (!nome && produtoBaseId) {
      const base = await prisma.produtoBase.findFirst({
        where: { id: produtoBaseId, contaId: customData.contaId },
        select: { nome: true },
      });
      nome = base?.nome ?? "";
    }

    if (!nome && nomeVariante) {
      nome = nomeVariante;
    }

    if (!nome) {
      return ResponseHandler(
        res,
        "Informe o nome do produto para gerar o SKU",
        null,
        400
      );
    }

    const sku = await gerarSkuUnico(
      prisma,
      customData.contaId,
      nome,
      nomeVariante
    );

    return ResponseHandler(res, "SKU gerado com sucesso", { sku });
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

    // Campos fiscais da variante. null limpa; undefined é ignorado pelo Prisma.
    const fiscalData = {
      ncm: data.ncm,
      cest: data.cest,
      cfop: data.cfop,
      origem: data.origem,
      codigoProduto: data.codigoProduto,
      aliquotaIcms: data.aliquotaIcms,
      aliquotaIpi: data.aliquotaIpi,
      aliquotaPis: data.aliquotaPis,
      aliquotaCofins: data.aliquotaCofins,
      issAliquota: data.issAliquota,
    };

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
        const varianteAtual = await tx.produto.findFirst({
          where: { id: data.id, contaId: customData.contaId },
          select: { id: true, codigo: true },
        });
        if (varianteAtual) {
          const bloqueioSku = await verificarBloqueioSku(
            tx,
            varianteAtual,
            data.codigo
          );
          if (bloqueioSku) throw new SkuBloqueadoError(bloqueioSku);
        }

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
            precoPromocional: data.precoPromocional ?? null,
            entradas: data.entradas,
            saidas: data.saidas,
            controlaEstoque: data.controlaEstoque,
            producaoLocal: data.producaoLocal,
            mostrarNoPdv: data.mostrarNoPdv,
            mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
            materiaPrima: data.materiaPrima,
            custoMedioProducao: data.custoMedioProducao,
            ...fiscalData,
          },
        });
      }

      const codigoFinal =
        data.codigo?.trim() ||
        (await gerarSkuUnico(
          tx,
          customData.contaId,
          base.nome,
          data.nomeVariante
        ));

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
          precoPromocional: data.precoPromocional ?? null,
          precoCompra: data.precoCompra,
          entradas: data.entradas,
          saidas: data.saidas,
          unidade: data.unidade,
          estoque: data.estoque || 0,
          minimo: data.minimo || 0,
          codigo: codigoFinal,
          controlaEstoque: data.controlaEstoque,
          producaoLocal: data.producaoLocal,
          mostrarNoPdv: data.mostrarNoPdv,
          mostrarNoCatalogo: data.mostrarNoCatalogo ?? undefined,
          materiaPrima: data.materiaPrima,
          custoMedioProducao: data.custoMedioProducao,
          ehPadrao: false,
          ...fiscalData,
        },
      });
    });

    return ResponseHandler(res, "Variante salva com sucesso", variante, 201);
  } catch (error) {
    if (error instanceof SkuBloqueadoError) {
      return ResponseHandler(res, error.message, null, 409);
    }
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

    // Tratativa: ao excluir a variante, apaga também a imagem do storage para não ocupar espaço.
    if (variante.imagem) {
      await deleteStoredFile(variante.imagem).catch(() => undefined);
    }

    return ResponseHandler(res, "Variante excluída com sucesso", variante);
  } catch (error) {
    handleError(res, error);
  }
};

// Envio da imagem de uma variante: reescala/comprime (mesmo tratamento do chat) e sobe no storage
// público (R2), substituindo a imagem anterior. Uma imagem por variante.
export const uploadVarianteImagem = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return ResponseHandler(res, "Variante inválida", null, 400);
    }
    if (!req.file) {
      return ResponseHandler(res, "Nenhuma imagem enviada", null, 400);
    }
    if (!req.file.mimetype?.startsWith("image/")) {
      return ResponseHandler(res, "O arquivo enviado não é uma imagem", null, 400);
    }

    const variante = await prisma.produto.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true, imagem: true },
    });
    if (!variante) {
      return ResponseHandler(res, "Variante não encontrada", null, 404);
    }

    // Scale down para evitar imagens grandes (limita a maior dimensão e recomprime).
    const processed = await downscaleImage(req.file.buffer, req.file.mimetype, {
      maxDimension: 1280,
      quality: 72,
    });

    // Remove a imagem anterior antes de subir a nova.
    if (variante.imagem) {
      await deleteStoredFile(variante.imagem).catch(() => undefined);
    }

    // Chave única por upload: garante uma URL nova a cada troca (evita cache do
    // navegador/CDN servir a imagem antiga) e mantém a referência anterior distinta
    // para que a limpeza acima realmente apague o arquivo antigo.
    const key = buildScopedUploadKey(
      customData.contaId,
      `produtos/variantes/variante_${variante.id}`,
      `variante-${variante.id}-${randomUUID()}.${processed.extension}`
    );

    const file = await uploadPublicFile({
      key,
      body: processed.buffer,
      contentType: processed.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });

    await prisma.produto.update({
      where: { id: variante.id, contaId: customData.contaId },
      data: { imagem: file.reference },
    });

    return ResponseHandler(res, "Imagem da variante enviada com sucesso", {
      id: variante.id,
      imagem: file.reference,
      imagemUrl: file.url,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Remove a imagem de uma variante (apaga do storage e limpa o campo).
export const deleteVarianteImagem = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const customData = getCustomRequest(req).customData;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return ResponseHandler(res, "Variante inválida", null, 400);
    }

    const variante = await prisma.produto.findFirst({
      where: { id, contaId: customData.contaId },
      select: { id: true, imagem: true },
    });
    if (!variante) {
      return ResponseHandler(res, "Variante não encontrada", null, 404);
    }

    if (variante.imagem) {
      await deleteStoredFile(variante.imagem).catch(() => undefined);
      await prisma.produto.update({
        where: { id: variante.id, contaId: customData.contaId },
        data: { imagem: null },
      });
    }

    return ResponseHandler(res, "Imagem da variante removida com sucesso", {
      id: variante.id,
    });
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
    const pageSize = clampPageSize(req.query.pageSize);
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
      orderBy: sanitizeSort(sortBy, order, { fallback: "nome" }),
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
