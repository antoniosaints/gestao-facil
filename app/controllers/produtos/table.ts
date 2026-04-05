import { Request, Response } from "express";
import { Prisma, Status } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

function getSortOrder(order?: string): Prisma.SortOrder {
  return order === "desc" ? "desc" : "asc";
}

function mapVariantRow(produto: any) {
  return {
    id: produto.id,
    contaId: produto.contaId,
    Uid: produto.Uid,
    status: produto.status,
    nome: produto.nome,
    nomeVariante: produto.nomeVariante,
    descricao: produto.descricao,
    preco: produto.preco,
    precoCompra: produto.precoCompra,
    entradas: produto.entradas,
    saidas: produto.saidas,
    unidade: produto.unidade,
    estoque: produto.estoque,
    minimo: produto.minimo,
    codigo: produto.codigo,
    controlaEstoque: produto.controlaEstoque,
    producaoLocal: produto.producaoLocal,
    mostrarNoPdv: produto.mostrarNoPdv,
    materiaPrima: produto.materiaPrima,
    custoMedioProducao: produto.custoMedioProducao,
    ehPadrao: produto.ehPadrao,
    produtoBaseId: produto.produtoBaseId,
    produtoBaseNome: produto.ProdutoBase?.nome ?? produto.nome,
    produtoBaseUid: produto.ProdutoBase?.Uid ?? null,
    categoria: produto.ProdutoBase?.Categoria?.nome ?? produto.categoria ?? null,
  };
}

export const tableProdutos = async (req: Request, res: Response) => {
  const customData = getCustomRequest(req).customData;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = getSortOrder(req.query.order as string);
  const { listingMode, ...filters } = req.query;

  if (listingMode === "variante") {
    const where: Prisma.ProdutoWhereInput = {
      contaId: customData.contaId,
    };

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { nomeVariante: { contains: search } },
        { codigo: { contains: search } },
        { descricao: { contains: search } },
        { Uid: { contains: search } },
        { ProdutoBase: { nome: { contains: search } } },
        { ProdutoBase: { Categoria: { nome: { contains: search } } } },
      ];
    }

    if (filters.status) {
      where.status = filters.status as Status;
    }

    const variantSortMap: Record<string, Prisma.ProdutoOrderByWithRelationInput> = {
      id: { id: order },
      Uid: { Uid: order },
      nome: { nome: order },
      nomeVariante: { nomeVariante: order },
      preco: { preco: order },
      estoque: { estoque: order },
      codigo: { codigo: order },
      produtoBaseNome: { ProdutoBase: { nome: order } },
    };

    const total = await prisma.produto.count({ where });
    const data = await prisma.produto.findMany({
      where,
      orderBy: variantSortMap[sortBy] ?? { id: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        ProdutoBase: {
          include: {
            Categoria: true,
          },
        },
      },
    });

    return res.json({
      data: data.map(mapVariantRow),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  const where: Prisma.ProdutoBaseWhereInput = {
    contaId: customData.contaId,
  };

  if (search) {
    where.OR = [
      { nome: { contains: search } },
      { descricao: { contains: search } },
      { Uid: { contains: search } },
      { Categoria: { nome: { contains: search } } },
      {
        variantes: {
          some: {
            OR: [{ nomeVariante: { contains: search } }, { codigo: { contains: search } }],
          },
        },
      },
    ];
  }

  if (filters.status) {
    where.status = filters.status as Status;
  }

  const total = await prisma.produtoBase.count({ where });
  const data = await prisma.produtoBase.findMany({
    where,
    orderBy: { [sortBy]: order },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      Categoria: true,
      variantes: {
        orderBy: [{ ehPadrao: "desc" }, { id: "asc" }],
      },
    },
  });

  return res.json({
    data: data.map((base) => {
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
        totalVariantes: base.variantes.length,
        estoqueTotal: base.variantes.reduce((acc, item) => acc + item.estoque, 0),
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
        variantePadraoId: variantePadrao?.id ?? null,
      };
    }),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
};
