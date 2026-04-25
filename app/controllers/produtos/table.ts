import { Request, Response } from "express";
import { Prisma } from "../../../generated";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";
import {
  buildProdutoBaseWhere,
  buildProdutoVarianteWhere,
  getSalesTotalsByBaseIds,
  getSalesTotalsByVariantIds,
  isProdutoBaseLowStock,
  isProdutoVariantLowStock,
  matchesEstoqueBaixoFilter,
  parseProdutoListingFilters,
} from "./listingFilters";

function getSortOrder(order?: string): Prisma.SortOrder {
  return order === "desc" ? "desc" : "asc";
}

function compareValues(a: unknown, b: unknown, order: Prisma.SortOrder) {
  const direction = order === "desc" ? -1 : 1;
  const numericA = Number(a as any);
  const numericB = Number(b as any);

  if (Number.isFinite(numericA) && Number.isFinite(numericB)) {
    return (numericA - numericB) * direction;
  }

  const normalizedA = String(a ?? "").toLowerCase();
  const normalizedB = String(b ?? "").toLowerCase();
  if (normalizedA < normalizedB) return -1 * direction;
  if (normalizedA > normalizedB) return 1 * direction;
  return 0;
}

function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  return {
    data: rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    total,
    totalPages: Math.ceil(total / pageSize),
  };
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
    categoriaId: produto.ProdutoBase?.categoriaId ?? null,
    categoria: produto.ProdutoBase?.Categoria?.nome ?? produto.categoria ?? null,
    totalVendas: 0,
  };
}

function mapBaseRow(base: any) {
  const variantePadrao = base.variantes.find((item: any) => item.ehPadrao) ?? base.variantes[0] ?? null;

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
    estoqueTotal: base.variantes.reduce((acc: number, item: any) => acc + item.estoque, 0),
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
    totalVendas: 0,
  };
}

export const tableProdutos = async (req: Request, res: Response) => {
  const customData = getCustomRequest(req).customData;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;
  const search = (req.query.search as string) || "";
  const sortBy = (req.query.sortBy as string) || "id";
  const order = getSortOrder(req.query.order as string);
  const listingMode = req.query.listingMode as string | undefined;
  const filters = parseProdutoListingFilters(req.query as Record<string, unknown>);

  if (listingMode === "variante") {
    const where = buildProdutoVarianteWhere(customData.contaId, filters);

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

    const needsInMemoryProcessing =
      filters.estoqueBaixo !== "TODOS" || filters.maisVendas === "SIM" || sortBy === "maisVendas";

    if (!needsInMemoryProcessing) {
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

    const variants = await prisma.produto.findMany({
      where,
      include: {
        ProdutoBase: {
          include: {
            Categoria: true,
          },
        },
      },
    });

    let rows = variants.map(mapVariantRow);

    rows = rows.filter((row) => matchesEstoqueBaixoFilter(isProdutoVariantLowStock(row), filters.estoqueBaixo));

    const salesTotals = await getSalesTotalsByVariantIds(
      customData.contaId,
      rows.map((item) => item.id),
    );

    rows = rows.map((row) => ({
      ...row,
      totalVendas: salesTotals.get(row.id) || 0,
    }));

    if (filters.maisVendas === "SIM") {
      rows = rows.filter((row) => row.totalVendas > 0);
      rows.sort((a, b) => compareValues(a.totalVendas, b.totalVendas, order));
    } else if (sortBy === "maisVendas") {
      rows.sort((a, b) => compareValues(a.totalVendas, b.totalVendas, order));
    } else {
      rows.sort((a, b) => compareValues((a as any)[sortBy], (b as any)[sortBy], order));
    }

    const paginated = paginate(rows, page, pageSize);

    return res.json({
      data: paginated.data,
      page,
      pageSize,
      total: paginated.total,
      totalPages: paginated.totalPages,
    });
  }

  const where = buildProdutoBaseWhere(customData.contaId, filters);

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

  const needsInMemoryProcessing =
    filters.estoqueBaixo !== "TODOS" || filters.maisVendas === "SIM" || sortBy === "maisVendas";

  if (!needsInMemoryProcessing) {
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
      data: data.map(mapBaseRow),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  }

  const bases = await prisma.produtoBase.findMany({
    where,
    include: {
      Categoria: true,
      variantes: {
        orderBy: [{ ehPadrao: "desc" }, { id: "asc" }],
      },
    },
  });

  let rows = bases.map(mapBaseRow);

  rows = rows.filter((row, index) => matchesEstoqueBaixoFilter(isProdutoBaseLowStock(bases[index]), filters.estoqueBaixo));

  const salesTotals = await getSalesTotalsByBaseIds(
    customData.contaId,
    rows.map((item) => item.id),
  );

  rows = rows.map((row) => ({
    ...row,
    totalVendas: salesTotals.get(row.id) || 0,
  }));

  if (filters.maisVendas === "SIM") {
    rows = rows.filter((row) => row.totalVendas > 0);
    rows.sort((a, b) => compareValues(a.totalVendas, b.totalVendas, order));
  } else if (sortBy === "maisVendas") {
    rows.sort((a, b) => compareValues(a.totalVendas, b.totalVendas, order));
  } else {
    rows.sort((a, b) => compareValues((a as any)[sortBy], (b as any)[sortBy], order));
  }

  const paginated = paginate(rows, page, pageSize);

  return res.json({
    data: paginated.data,
    page,
    pageSize,
    total: paginated.total,
    totalPages: paginated.totalPages,
  });
};
